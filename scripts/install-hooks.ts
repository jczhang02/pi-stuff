import {existsSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Effect} from 'effect';
import husky from 'husky';
import {git} from './git';
import {InputError, readText} from './parse';

function install() {
  return Effect.gen(function* () {
    const directory = process.cwd();
    if ((yield* git(directory, ['rev-parse', '--show-prefix'])).trim())
      return yield* Effect.fail(
        new InputError({message: 'Run setup at the repository root.'}),
      );
    const configured = (yield* git(directory, [
      'config',
      '--default',
      '',
      '--get',
      'core.hooksPath',
    ])).replace(/\n$/, '');
    if (configured && configured !== '.husky/_')
      return yield* Effect.fail(
        new InputError({
          message:
            'Existing core.hooksPath: inspect it with the maintainer before setup.',
        }),
      );
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
        const error = husky();
        if (error)
          throw new Error('Husky installation failed or was disabled.');
      },
      catch: error =>
        new InputError({
          message:
            error instanceof Error ? error.message : 'Hook setup failed.',
        }),
    });
    const installed = (yield* git(directory, [
      'config',
      '--get',
      'core.hooksPath',
    ])).trim();
    if (installed !== '.husky/_')
      return yield* Effect.fail(
        new InputError({message: 'Husky hook path was not installed.'}),
      );
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
