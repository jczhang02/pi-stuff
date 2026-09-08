import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {checkMessage} from './check-commit';

const ROOT = resolve(import.meta.dir, '..');
const CHECK = resolve(ROOT, 'scripts/check-commit.ts');
const INSTALL = resolve(ROOT, 'scripts/install-hooks.ts');
const ZERO = '0'.repeat(40);

for (const message of [
  'feat: add a feature / 添加功能',
  'fix(parser)!: Preserve Unicode 🐈',
  'revert: undo a change',
  'merge: incorporate the branch',
  'custom: No fixed type list or Subject Case rule',
  'réparation(解析): Unicode description café',
  'fix: ' + '长'.repeat(500),
  'feat!: change interface\n\nBREAKING CHANGE: remove old entry point',
  'feat: change interface\r\n\r\nBody text.\r\nAnother line.\r\n\r\nBREAKING-CHANGE: remove old entry point\r\nMore detail.\r\nRefs #16\r\n',
  'fix: update\n\nFirst paragraph.\n\nSecond paragraph.\n\nReviewed-by: A\nRefs: #16',
  'fix: $(touch /tmp/do-not-execute) `echo data` $HOME',
  'fix: title\n\nBody.\nRefs: #16',
  'feat: title\n\nbreaking change: invalid case',
  'feat: title\n\nBREAKING CHANGE: ',
  'docs: explain a format\n\nExample text:\nToken: value',
  'docs: quote invalid footers\n\n```text\nbreaking change: invalid example\nBREAKING CHANGE: \n```',
]) {
  test(`accepts conventional structure ${JSON.stringify(message.slice(0, 65))}`, () => {
    expect(checkMessage(message)).toEqual([]);
  });
}
for (const message of [
  '',
  'Fix: wrong type case',
  'feat:no space',
  'feat: ',
  'feat:\ttext',
  'feat(): empty scope',
  'feat(  ): blank scope',
  'feat(a(b)): nesting',
  'feat!!: duplicate marker',
  'feat(scope)! : misplaced marker',
  'fix: title\nbody',
  'fix: title\rbody',
  'fix: title\u0000hidden',
  'fixup! fix: previous',
  'squash! feat: previous',
  'Revert "previous"',
  "Merge branch 'main'",
]) {
  test(`rejects malformed structure ${JSON.stringify(message)}`, () => {
    expect(checkMessage(message).length).toBeGreaterThan(0);
  });
}

describe('commit checker Git and CLI seam', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(resolve(tmpdir(), 'pi-commit-'));
    git('init', '-b', 'main');
  });
  afterEach(() => rmSync(directory, {recursive: true, force: true}));

  // Deliberately do not inherit GIT_DIR, worktree configuration, global hooks,
  // Husky startup files, or event variables from the repository running tests.
  function environment() {
    return {
      PATH: process.env.PATH ?? '',
      HOME: directory,
      XDG_CONFIG_HOME: directory,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    };
  }
  function command(args: string[], cwd = directory) {
    return Bun.spawnSync(args, {
      cwd,
      env: environment(),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    });
  }
  function git(...args: string[]): string {
    const result = command(['git', ...args]);
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  }
  function commit(message: string): string {
    git('commit', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  }
  function event(name: string, sha = '', ref = '', cwd = directory) {
    return Bun.spawnSync([process.execPath, CHECK], {
      cwd,
      env: {
        ...environment(),
        GITHUB_EVENT_NAME: name,
        GITHUB_EVENT_PATH: resolve(directory, 'event.json'),
        GITHUB_SHA: sha,
        GITHUB_REF: ref,
      },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    });
  }
  function pullRequest(
    base: string,
    head: string,
    title = 'feat: squash title',
    draft = false,
  ) {
    writeFileSync(
      resolve(directory, 'event.json'),
      JSON.stringify({
        pull_request: {base: {sha: base}, head: {sha: head}, title, draft},
      }),
    );
    return event('pull_request');
  }
  function push(before: string, after: string) {
    writeFileSync(
      resolve(directory, 'event.json'),
      JSON.stringify({
        ref: 'refs/heads/main',
        before,
        after,
        size: 0,
        commits: [],
      }),
    );
    return event('push');
  }
  function setupFiles() {
    symlinkSync(
      resolve(ROOT, 'node_modules'),
      resolve(directory, 'node_modules'),
    );
    symlinkSync(resolve(ROOT, 'scripts'), resolve(directory, 'scripts'));
    copyFileSync(
      resolve(ROOT, 'package.json'),
      resolve(directory, 'package.json'),
    );
    mkdirSync(resolve(directory, '.husky'));
    copyFileSync(
      resolve(ROOT, '.husky/commit-msg'),
      resolve(directory, '.husky/commit-msg'),
    );
  }

  for (const payload of [
    Buffer.from('fix: valid\0private-invalid'),
    Buffer.concat([
      Buffer.from('fix: valid\0private-invalid '),
      Buffer.from([0xff]),
    ]),
    Buffer.concat([
      Buffer.from('fix: valid\n\nprivate-invalid '),
      Buffer.from([0xff]),
    ]),
  ]) {
    for (const name of ['pull_request', 'push', 'workflow_dispatch']) {
      test(`raw commit bytes reject ${payload.toString('hex')} through ${name}`, () => {
        const base = commit('feat: root');
        const tree = git('rev-parse', 'HEAD^{tree}');
        const object = resolve(directory, 'raw-commit');
        writeFileSync(
          object,
          Buffer.concat([
            Buffer.from(
              `tree ${tree}\nparent ${base}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\n`,
            ),
            payload,
          ]),
        );
        const head = git(
          'hash-object',
          '--literally',
          '-t',
          'commit',
          '-w',
          object,
        );
        writeFileSync(resolve(directory, 'event.json'), '{"ref":"main"}');
        const result =
          name === 'pull_request'
            ? pullRequest(base, head)
            : name === 'push'
              ? push(base, head)
              : event(name, head, 'refs/heads/main');
        expect(result.exitCode).toBe(1);
        expect(result.stderr.toString()).not.toContain('private-invalid');
      });
    }
  }
  for (const name of ['pull_request', 'push', 'workflow_dispatch']) {
    test(`raw malformed commit metadata fails ${name}`, () => {
      const base = commit('feat: root');
      const object = resolve(directory, 'raw-commit');
      writeFileSync(
        object,
        `tree ${git('rev-parse', 'HEAD^{tree}')}\nparent ${base}\nauthor malformed\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfix: valid message`,
      );
      const head = git(
        'hash-object',
        '--literally',
        '-t',
        'commit',
        '-w',
        object,
      );
      writeFileSync(resolve(directory, 'event.json'), '{"ref":"main"}');
      const result =
        name === 'pull_request'
          ? pullRequest(base, head)
          : name === 'push'
            ? push(base, head)
            : event(name, head, 'refs/heads/main');
      expect(result.exitCode).toBe(1);
    });
  }
  test('raw commit without a header/message separator fails dispatch', () => {
    commit('feat: root');
    const object = resolve(directory, 'raw-commit');
    writeFileSync(
      object,
      `tree ${git('rev-parse', 'HEAD^{tree}')}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\nfix: not a message`,
    );
    const head = git(
      'hash-object',
      '--literally',
      '-t',
      'commit',
      '-w',
      object,
    );
    writeFileSync(resolve(directory, 'event.json'), '{"ref":"main"}');
    expect(event('workflow_dispatch', head, 'refs/heads/main').exitCode).toBe(
      1,
    );
  });

  test('PR introduced set checks invalid middle commits, not historical base or counts', () => {
    const base = commit('Historical message');
    commit('feat: first');
    const bad = commit('invalid middle');
    const head = commit('fix: last');
    const result = pullRequest(base, head);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(bad);
    expect(result.stderr.toString()).not.toContain(base);
  });
  test('behind base uses a common ancestor, not base-is-ancestor', () => {
    commit('Historical root');
    git('branch', 'topic');
    const base = commit('Historical base-only message');
    git('checkout', 'topic');
    const head = commit('feat: branch behind main');
    expect(pullRequest(base, head).exitCode).toBe(0);
  });
  test('merged base-only history is excluded from the introduced set', () => {
    commit('Historical root');
    git('branch', 'topic');
    const base = commit('Historical base-only message');
    git('checkout', 'topic');
    commit('feat: topic');
    git('merge', '--no-ff', 'main', '-m', 'merge: incorporate base');
    expect(pullRequest(base, git('rev-parse', 'HEAD')).exitCode).toBe(0);
  });
  test('PR title is actual event title, not head subject, including drafts', () => {
    const base = commit('Historical root');
    const head = commit('feat: valid head');
    for (const draft of [false, true]) {
      for (const title of [
        'bad title',
        'feat: first\n\nsecond',
        'feat: \u0000hidden',
      ]) {
        const result = pullRequest(base, head, title, draft);
        expect(result.exitCode).toBe(1);
        expect(result.stderr.toString()).toContain('PR title');
      }
      expect(
        pullRequest(
          base,
          head,
          'fix: a different valid squash title / 标题',
          draft,
        ).exitCode,
      ).toBe(0);
    }
  });
  test('valid title cannot hide an invalid draft commit', () => {
    const base = commit('Historical root');
    expect(
      pullRequest(base, commit('bad commit'), 'fix: title', true).exitCode,
    ).toBe(1);
  });
  test('untrusted text is never executed or echoed', () => {
    const base = commit('Historical root');
    const marker = resolve(directory, 'executed');
    const text = `feat: $(touch ${marker}) \`touch ${marker}\``;
    const head = commit(text);
    expect(pullRequest(base, head, text).exitCode).toBe(0);
    const result = pullRequest(
      base,
      head,
      text.replace('feat:', 'private-invalid'),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).not.toContain(marker);
    expect(existsSync(marker)).toBe(false);
  });
  test('push checks every introduced commit and ignores supplied lists/counts', () => {
    const base = commit('Historical root');
    commit('fix: valid first');
    const bad = commit('invalid middle');
    const result = push(base, commit('feat: valid last'));
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(bad);
    expect(push(git('rev-parse', 'HEAD'), commit('chore: next')).exitCode).toBe(
      0,
    );
  });
  test('initial pushes check all reachable history and deletions fail', () => {
    const root = commit('feat: initial');
    expect(push(ZERO, root).exitCode).toBe(0);
    const bad = commit('invalid second');
    const head = commit('feat: third');
    const result = push(ZERO, head);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(bad);
    expect(push(head, ZERO).exitCode).toBe(1);
  });
  test('full SHA-256 object IDs work through the real Git boundary', () => {
    rmSync(resolve(directory, '.git'), {recursive: true});
    git('init', '-b', 'main', '--object-format=sha256');
    const base = commit('feat: initial');
    expect(base.length).toBe(64);
    expect(push('0'.repeat(64), base).exitCode).toBe(0);
    const head = commit('fix: next');
    expect(push(base, head).exitCode).toBe(0);
    expect(pullRequest(base, head).exitCode).toBe(0);
  });
  test('force push uses introduced-set semantics without assuming ancestry', () => {
    commit('Historical root');
    git('branch', 'topic');
    const before = commit('Historical removed commit');
    git('checkout', 'topic');
    expect(push(before, commit('fix: replacement')).exitCode).toBe(0);
  });
  test('dispatch checks only GITHUB_SHA and requires matching event ref', () => {
    commit('Historical root');
    const valid = commit('feat: selected');
    const invalid = commit('invalid later');
    writeFileSync(resolve(directory, 'event.json'), '{"ref":"main"}');
    expect(event('workflow_dispatch', valid, 'refs/heads/main').exitCode).toBe(
      0,
    );
    expect(
      event('workflow_dispatch', invalid, 'refs/heads/main').exitCode,
    ).toBe(1);
    expect(event('workflow_dispatch', valid, 'refs/heads/other').exitCode).toBe(
      1,
    );
    expect(event('workflow_dispatch', '', 'refs/heads/main').exitCode).toBe(1);
    expect(
      event('workflow_dispatch', '--all', 'refs/heads/main').exitCode,
    ).toBe(1);
  });
  test('missing objects, noncommit objects and unrelated PR history fail closed', () => {
    const base = commit('Historical root');
    const head = commit('fix: valid');
    for (const missing of [
      'a'.repeat(40),
      ZERO,
      git('rev-parse', 'HEAD^{tree}'),
    ]) {
      expect(pullRequest(missing, head).exitCode).toBe(1);
      expect(pullRequest(base, missing).exitCode).toBe(1);
      expect(push(missing, head).exitCode).toBe(1);
    }
    git('checkout', '--orphan', 'unrelated');
    expect(pullRequest(base, commit('feat: unrelated')).exitCode).toBe(1);
  });
  test('missing intermediate history cannot silently shorten a range', () => {
    const base = commit('feat: root');
    const middle = commit('feat: middle');
    const head = commit('feat: head');
    rmSync(
      resolve(directory, '.git/objects', middle.slice(0, 2), middle.slice(2)),
    );
    expect(pullRequest(base, head).exitCode).toBe(1);
    expect(push(base, head).exitCode).toBe(1);
  });
  test('shallow checkouts fail for PR, push and dispatch even with endpoints present', () => {
    const base = commit('feat: root');
    const head = commit('feat: head');
    const shallow = resolve(directory, 'shallow');
    git('clone', '--depth=2', `file://${directory}`, shallow);
    pullRequest(base, head);
    expect(event('pull_request', '', '', shallow).exitCode).toBe(1);
    push(base, head);
    expect(event('push', '', '', shallow).exitCode).toBe(1);
    writeFileSync(resolve(directory, 'event.json'), '{"ref":"main"}');
    expect(
      event('workflow_dispatch', head, 'refs/heads/main', shallow).exitCode,
    ).toBe(1);
  });
  describe('malformed event fields and unknown/privileged events fail without payload disclosure', () => {
    for (const text of [
      'private-invalid',
      'null',
      '[]',
      '{}',
      '{"pull_request":false}',
      '{"pull_request":{"title":42}}',
      '{"pull_request":{"title":"feat: title","head":{"sha":"--all"},"base":{"sha":"HEAD"}}}',
      '{"ref":"refs/heads/main","before":false,"after":42}',
    ]) {
      for (const name of [
        'pull_request',
        'push',
        'workflow_dispatch',
        'pull_request_target',
        'merge_group',
        '',
      ]) {
        test(`${JSON.stringify(text)} / ${JSON.stringify(name)}`, () => {
          commit('feat: root');
          writeFileSync(resolve(directory, 'event.json'), text);
          const result = event(name);
          expect(result.exitCode).toBe(1);
          expect(result.stderr.toString()).toBe(
            'Cannot check commit input or history (InputError).\n',
          );
        });
      }
    }
  });
  test('push events for other branches and mismatched object formats fail closed', () => {
    const head = commit('feat: root');
    for (const data of [
      {ref: 'refs/heads/topic', before: ZERO, after: head},
      {ref: 'refs/heads/main', before: '0'.repeat(64), after: head},
    ]) {
      writeFileSync(resolve(directory, 'event.json'), JSON.stringify(data));
      expect(event('push').exitCode).toBe(1);
    }
  });
  test('unconsumed event values do not become an unrelated JSON validation contract', () => {
    const base = commit('Historical root');
    const head = commit('fix: valid');
    pullRequest(base, head);
    const path = resolve(directory, 'event.json');
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace('{', '{"unused":1e400,"commits":0,'),
    );
    expect(event('pull_request').exitCode).toBe(0);
  });
  test('missing files, invalid UTF-8, absent Git and invalid invocation fail', () => {
    expect(command([process.execPath, CHECK, '--help']).exitCode).toBe(0);
    expect(command([process.execPath, CHECK, '--message-file']).exitCode).toBe(
      2,
    );
    expect(command([process.execPath, CHECK, '--bogus', 'x']).exitCode).toBe(2);
    expect(
      command([process.execPath, CHECK, '--message-file', 'missing-private'])
        .exitCode,
    ).toBe(1);
    expect(event('pull_request').exitCode).toBe(1);
    const path = resolve(directory, 'message');
    writeFileSync(path, Buffer.from([0xff]));
    expect(
      command([process.execPath, CHECK, '--message-file', path]).exitCode,
    ).toBe(1);
    writeFileSync(path, 'fix: valid\u0000hidden\n');
    expect(
      command([process.execPath, CHECK, '--message-file', path]).exitCode,
    ).toBe(1);
    const head = commit('fix: valid history');
    writeFileSync(
      resolve(directory, 'event.json'),
      JSON.stringify({ref: 'main'}),
    );
    expect(event('workflow_dispatch', head, 'refs/heads/main').exitCode).toBe(
      0,
    );
    const result = Bun.spawnSync([process.execPath, CHECK], {
      cwd: directory,
      env: {
        ...environment(),
        PATH: directory,
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_EVENT_PATH: resolve(directory, 'event.json'),
        GITHUB_SHA: head,
        GITHUB_REF: 'refs/heads/main',
      },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    });
    expect(result.exitCode).toBe(1);
  });
  test('real hooks do not validate a cleaned message different from what Git stores', () => {
    setupFiles();
    expect(command([process.execPath, INSTALL]).exitCode).toBe(0);
    for (const cleanup of ['whitespace', 'verbatim']) {
      expect(
        command([
          'git',
          'commit',
          '--allow-empty',
          `--cleanup=${cleanup}`,
          '-m',
          '# not a conventional header\nfix: hidden header',
        ]).exitCode,
      ).not.toBe(0);
    }
    expect(command(['git', 'rev-parse', '--verify', 'HEAD']).exitCode).not.toBe(
      0,
    );
  });
  for (const setting of ['core.commentChar=f', 'core.commentString=fix:']) {
    test(`real hook rejects cleanup deleting the header with ${setting}`, () => {
      setupFiles();
      expect(command([process.execPath, INSTALL]).exitCode).toBe(0);
      const result = command([
        'git',
        '-c',
        setting,
        'commit',
        '--allow-empty',
        '--cleanup=strip',
        '-m',
        'fix: removed\n\nnot conventional',
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(
        command(['git', 'rev-parse', '--verify', 'HEAD']).exitCode,
      ).not.toBe(0);
    });
  }
  test('real hook respects commentString precedence and auto without parsing body prose', () => {
    setupFiles();
    expect(command([process.execPath, INSTALL]).exitCode).toBe(0);
    git(
      '-c',
      'core.commentChar=f',
      '-c',
      'core.commentString=//',
      'commit',
      '--allow-empty',
      '--cleanup=strip',
      '-m',
      'fix: retained\n\n// removed\nBody.\nBREAKING CHANGE: ',
    );
    expect(git('show', '--format=%B', '--no-patch', 'HEAD')).toBe(
      'fix: retained\n\nBody.\nBREAKING CHANGE:',
    );
    git(
      '-c',
      'core.commentChar=auto',
      'commit',
      '--allow-empty',
      '--cleanup=strip',
      '-m',
      'feat: auto retained\n\n# ordinary body\nText.',
    );
    expect(git('show', '--format=%B', '--no-patch', 'HEAD')).toBe(
      'feat: auto retained\n\n# ordinary body\nText.',
    );
  });
  test('setup preserves hook paths with meaningful surrounding whitespace', () => {
    setupFiles();
    const path = '.husky/_ ';
    git('config', 'core.hooksPath', path);
    expect(command([process.execPath, INSTALL]).exitCode).toBe(1);
    expect(
      command(['git', 'config', '--get', 'core.hooksPath']).stdout.toString(),
    ).toBe(`${path}\n`);
  });
  test('real Husky setup and Git commit-msg accept and reject messages', () => {
    setupFiles();
    expect(command([process.execPath, INSTALL]).exitCode).toBe(0);
    expect(git('config', '--get', 'core.hooksPath')).toBe('.husky/_');
    expect(
      command(['git', 'commit', '--allow-empty', '-m', 'bad commit']).exitCode,
    ).not.toBe(0);
    expect(command(['git', 'rev-parse', '--verify', 'HEAD']).exitCode).not.toBe(
      0,
    );
    commit('feat(api)!: 实际提交 / real hook');
    expect(command([process.execPath, INSTALL]).exitCode).toBe(1);
    expect(readFileSync(resolve(directory, '.husky/commit-msg'), 'utf8')).toBe(
      readFileSync(resolve(ROOT, '.husky/commit-msg'), 'utf8'),
    );
  });
  test('real hook quotes file argv and requires header-first input regardless of comment characters', () => {
    setupFiles();
    expect(command([process.execPath, INSTALL]).exitCode).toBe(0);
    const path = resolve(directory, 'message $(touch executed) " quoted');
    writeFileSync(
      path,
      'fix: bilingual 修复\r\n\r\n# Git comment\r\nBody.\r\n',
    );
    expect(
      command(['git', 'hook', 'run', 'commit-msg', '--', path]).exitCode,
    ).toBe(0);
    git('config', 'core.commentChar', ';');
    writeFileSync(path, 'fix: custom comment character\n\n; Git comment\n');
    expect(
      command(['git', 'hook', 'run', 'commit-msg', '--', path]).exitCode,
    ).toBe(0);
    writeFileSync(path, '; comment\nnot conventional\n');
    expect(
      command(['git', 'hook', 'run', 'commit-msg', '--', path]).exitCode,
    ).not.toBe(0);
    expect(command(['git', 'hook', 'run', 'commit-msg']).exitCode).not.toBe(0);
    expect(existsSync(resolve(directory, 'executed'))).toBe(false);
  });
  test('setup invocation and disabled Husky fail without setting a hook path', () => {
    setupFiles();
    expect(command([process.execPath, INSTALL, '--help']).exitCode).toBe(0);
    expect(command([process.execPath, INSTALL, '--force']).exitCode).toBe(2);
    const disabled = Bun.spawnSync([process.execPath, INSTALL], {
      cwd: directory,
      env: {...environment(), HUSKY: '0'},
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    });
    expect(disabled.exitCode).toBe(1);
    expect(readdirSync(resolve(directory, '.husky'))).toEqual(['commit-msg']);
    expect(command(['git', 'config', '--get', 'core.hooksPath']).exitCode).toBe(
      1,
    );
    expect(existsSync(resolve(directory, '.husky/_'))).toBe(false);
  });
  test('failed helper generation in read-only .husky preserves exact real config', () => {
    setupFiles();
    const config = resolve(directory, '.git/config');
    const prior = readFileSync(config);
    const hooks = resolve(directory, '.husky');
    chmodSync(hooks, 0o555);
    try {
      expect(command([process.execPath, INSTALL]).exitCode).toBe(1);
      expect(readFileSync(config)).toEqual(prior);
      expect(readdirSync(hooks)).toEqual(['commit-msg']);
    } finally {
      chmodSync(hooks, 0o755);
    }
  });
  test('config publication failure preserves prior bytes and retains complete helpers', () => {
    setupFiles();
    const config = resolve(directory, '.git/config');
    const prior = readFileSync(config);
    writeFileSync(`${config}.lock`, 'another owner\n');
    expect(command([process.execPath, INSTALL]).exitCode).toBe(1);
    expect(readFileSync(config)).toEqual(prior);
    expect(readFileSync(`${config}.lock`, 'utf8')).toBe('another owner\n');
    expect(readdirSync(resolve(directory, '.husky')).sort()).toEqual([
      '_',
      'commit-msg',
    ]);
    const path = resolve(directory, 'message');
    writeFileSync(path, 'fix: complete helpers\n');
    expect(command(['sh', '.husky/_/commit-msg', path]).exitCode).toBe(0);
    writeFileSync(path, 'not conventional\n');
    expect(command(['sh', '.husky/_/commit-msg', path]).exitCode).toBe(1);
  });
  test('existing read-only helpers and disabled Husky preserve shared setup exactly', () => {
    setupFiles();
    git('config', 'core.hooksPath', '.husky/_');
    const config = resolve(directory, '.git/config');
    const prior = readFileSync(config);
    const disabled = Bun.spawnSync([process.execPath, INSTALL], {
      cwd: directory,
      env: {...environment(), HUSKY: '0'},
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    });
    expect(disabled.exitCode).toBe(1);
    expect(readFileSync(config)).toEqual(prior);
    expect(readdirSync(resolve(directory, '.husky'))).toEqual(['commit-msg']);
    const helpers = resolve(directory, '.husky/_');
    mkdirSync(helpers);
    writeFileSync(resolve(helpers, 'custom'), 'preserve me\n');
    chmodSync(helpers, 0o555);
    try {
      expect(command([process.execPath, INSTALL]).exitCode).toBe(1);
      expect(readFileSync(config)).toEqual(prior);
      expect(readdirSync(helpers)).toEqual(['custom']);
      expect(readFileSync(resolve(helpers, 'custom'), 'utf8')).toBe(
        'preserve me\n',
      );
    } finally {
      chmodSync(helpers, 0o755);
    }
  });
  test('setup preserves shared custom hooks masked by a worktree override', () => {
    setupFiles();
    commit('feat: root');
    git('config', 'extensions.worktreeConfig', 'true');
    git('config', '--local', 'core.hooksPath', 'custom-hooks');
    const hooks = resolve(directory, 'custom-hooks');
    mkdirSync(hooks);
    writeFileSync(resolve(hooks, 'commit-msg'), '#!/bin/sh\nexit 1\n', {
      mode: 0o755,
    });
    const linked = resolve(directory, 'linked');
    git('worktree', 'add', '-b', 'topic', linked);
    git('config', '--worktree', 'core.hooksPath', '.husky/_');
    const shared = readFileSync(resolve(directory, '.git/config'));
    const override = readFileSync(resolve(directory, '.git/config.worktree'));
    expect(command([process.execPath, INSTALL]).exitCode).toBe(1);
    expect(readFileSync(resolve(directory, '.git/config'))).toEqual(shared);
    expect(readFileSync(resolve(directory, '.git/config.worktree'))).toEqual(
      override,
    );
    // The second worktree still uses the shared custom hook directory.
    symlinkSync(hooks, resolve(linked, 'custom-hooks'));
    expect(
      command(['git', 'commit', '--allow-empty', '-m', 'fix: rejected'], linked)
        .exitCode,
    ).not.toBe(0);
    expect(existsSync(resolve(directory, '.husky/_'))).toBe(false);
  });
  for (const paths of [
    [''],
    [' '],
    ['.husky/_', '.husky/_'],
    ['custom-hooks', '.husky/_'],
  ]) {
    test(`setup preserves exact shared hooks configuration ${JSON.stringify(paths)}`, () => {
      setupFiles();
      for (const path of paths) git('config', '--add', 'core.hooksPath', path);
      const prior = readFileSync(resolve(directory, '.git/config'));
      expect(command([process.execPath, INSTALL]).exitCode).toBe(1);
      expect(readFileSync(resolve(directory, '.git/config'))).toEqual(prior);
      expect(existsSync(resolve(directory, '.husky/_'))).toBe(false);
    });
  }
  test('setup refuses existing hook paths and default hooks without overwriting', () => {
    setupFiles();
    git('config', 'core.hooksPath', 'custom-hooks');
    expect(command([process.execPath, INSTALL]).exitCode).toBe(1);
    expect(git('config', '--get', 'core.hooksPath')).toBe('custom-hooks');
    git('config', '--unset', 'core.hooksPath');
    const path = resolve(directory, '.git/hooks/commit-msg');
    writeFileSync(path, 'echo existing\n');
    expect(command([process.execPath, INSTALL]).exitCode).toBe(1);
    expect(readFileSync(path, 'utf8')).toBe('echo existing\n');
    expect(existsSync(resolve(directory, '.husky/_'))).toBe(false);
  });
  test('linked worktree setup accepts the shared path and generates its own helpers', () => {
    setupFiles();
    commit('feat: root');
    expect(command([process.execPath, INSTALL]).exitCode).toBe(0);
    const linked = resolve(directory, 'linked');
    git('worktree', 'add', '-b', 'topic', linked);
    mkdirSync(resolve(linked, '.husky'));
    copyFileSync(
      resolve(ROOT, '.husky/commit-msg'),
      resolve(linked, '.husky/commit-msg'),
    );
    expect(command([process.execPath, INSTALL], linked).exitCode).toBe(0);
    expect(existsSync(resolve(linked, '.husky/_/commit-msg'))).toBe(true);
    expect(git('config', '--get', 'core.hooksPath')).toBe('.husky/_');
  });
});
