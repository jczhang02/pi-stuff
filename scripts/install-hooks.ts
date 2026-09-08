import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import {relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Effect} from 'effect';
import {git} from './git';
import {InputError, readText} from './parse';

function install() {
  return Effect.gen(function* () {
    const directory = process.cwd();
    if ((yield* git(directory, ['rev-parse', '--show-prefix'])).trim())
      return yield* Effect.fail(
        new InputError({message: 'Run setup at the repository root.'}),
      );
    // Check both the shared scope we will write and all effective scopes.
    // NUL records distinguish absent, empty, whitespace and repeated values.
    for (const scope of [['--local'], []]) {
      const records = (yield* git(directory, [
        'config',
        ...scope,
        '--includes',
        '--show-scope',
        '--null',
        '--list',
      ])).split('\0');
      const seen = new Set<string>();
      for (let index = 0; index < records.length - 1; index += 2) {
        const entry = records[index + 1]!;
        if (entry.split('\n', 1)[0] !== 'core.hookspath') continue;
        const origin = records[index]!;
        if (seen.has(origin) || entry !== 'core.hookspath\n.husky/_')
          return yield* Effect.fail(
            new InputError({
              message:
                'Existing core.hooksPath: inspect it with the maintainer before setup.',
            }),
          );
        seen.add(origin);
      }
    }
    const hooks = (yield* git(directory, [
      'rev-parse',
      '--git-path',
      'hooks',
    ])).replace(/\n$/, '');
    yield* readText(resolve(directory, '.husky/commit-msg'));
    yield* Effect.try({
      try: () => {
        if (existsSync(resolve(directory, '.husky/_')))
          throw new Error(
            'Existing .husky/_: inspect and remove generated helpers before reinstalling.',
          );
        if (
          existsSync(hooks) &&
          readdirSync(hooks).some(name => !name.endsWith('.sample'))
        )
          throw new Error(
            'Existing Git hooks: inspect them with the maintainer before setup.',
          );
        // Husky writes config before generating helpers. Confine that write
        // to a disposable file, then publish only a complete helper directory.
        const staging = mkdtempSync(resolve(directory, '.husky/install-'));
        try {
          const husky = new URL('bin.js', import.meta.resolve('husky'));
          const result = Bun.spawnSync(
            [
              process.execPath,
              fileURLToPath(husky),
              relative(directory, staging),
            ],
            {
              cwd: directory,
              env: {
                ...process.env,
                GIT_CONFIG: resolve(staging, 'config'),
                GIT_TERMINAL_PROMPT: '0',
              },
              stdin: 'ignore',
              stdout: 'pipe',
              stderr: 'pipe',
              timeout: 30_000,
            },
          );
          // This pinned CLI prints failures (including HUSKY=0) even when its
          // exit status is zero. Do not publish those partial/absent outputs.
          if (
            result.exitCode !== 0 ||
            result.signalCode ||
            result.stdout.length ||
            result.stderr.length
          )
            throw new Error('Husky installation failed or was disabled.');
          const helper = resolve(staging, '_/commit-msg');
          if (
            !lstatSync(helper).isFile() ||
            !(lstatSync(helper).mode & 0o111) ||
            readFileSync(helper, 'utf8') !==
              '#!/usr/bin/env sh\n. "$(dirname "$0")/h"' ||
            !readFileSync(resolve(staging, '_/h')).equals(
              readFileSync(new URL('husky', husky)),
            )
          )
            throw new Error('Husky helpers could not be verified.');
          if (existsSync(resolve(directory, '.husky/_')))
            throw new Error('Existing .husky/_: setup will not replace it.');
          renameSync(resolve(staging, '_'), resolve(directory, '.husky/_'));
        } finally {
          // Only artifacts created by this invocation are disposable.
          rmSync(staging, {recursive: true, force: true});
        }
      },
      catch: error =>
        new InputError({
          message:
            error instanceof Error ? error.message : 'Hook setup failed.',
        }),
    });
    // Git publishes config via its lockfile only after helpers are complete.
    // If this fails, keep verified helpers for inspection; never roll back or
    // remove somebody else's configuration. Setup still reports failure.
    yield* git(directory, ['config', '--local', 'core.hooksPath', '.husky/_']);
  });
}

export function main(args = process.argv.slice(2)): number {
  const usage = 'Usage: bun scripts/install-hooks.ts';
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) {
    console.log(usage);
    return 0;
  }
  if (args.length) {
    console.error(usage);
    return 2;
  }
  return Effect.runSync(
    Effect.match(install(), {
      onFailure: error => {
        // Only our setup diagnostics are useful here; file errors can carry paths.
        console.error(
          error.message.startsWith('ENOENT')
            ? 'Hook setup input is missing.'
            : error.message,
        );
        return 1;
      },
      onSuccess: () => {
        console.log(
          'Husky installed. core.hooksPath is shared by linked worktrees; set up each worktree before committing.',
        );
        return 0;
      },
    }),
  );
}

if (import.meta.main) process.exitCode = main();
