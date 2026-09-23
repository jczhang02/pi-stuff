import {spawn} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';

export interface GitSnapshot {
  branch: string;
  staged: number;
  modified: number;
  untracked: number;
  conflicts: number;
  ahead: number;
  behind: number;
  operation: string;
}

class GitError extends Schema.TaggedError<GitError>()('GitError', {
  outside: Schema.Boolean,
}) {}

function command(cwd: string, args: string[], signal: AbortSignal) {
  return Effect.tryPromise({
    try: effectSignal =>
      new Promise<string>((resolve, reject) => {
        const abortSignal = AbortSignal.any([signal, effectSignal]);
        if (abortSignal.aborted) {
          reject(new GitError({outside: false}));
          return;
        }
        let settled = false;
        const child = spawn('git', ['--no-optional-locks', ...args], {
          cwd,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0'},
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let bytes = 0;
        const killGroup = () => {
          try {
            if (child.pid !== undefined && process.platform !== 'win32')
              process.kill(-child.pid, 'SIGKILL');
            else child.kill('SIGKILL');
          } catch {
            // The group may have exited before cancellation arrived.
          }
        };
        const cleanup = () => {
          clearTimeout(timeout);
          abortSignal.removeEventListener('abort', abort);
        };
        const abort = () => {
          if (settled) return;
          settled = true;
          killGroup();
          cleanup();
          reject(new GitError({outside: false}));
        };
        const timeout = setTimeout(abort, 2000);
        for (const [stream, chunks] of [
          [child.stdout, stdout],
          [child.stderr, stderr],
        ] as const) {
          stream.on('data', (chunk: Buffer) => {
            if (settled) return;
            bytes += chunk.byteLength;
            if (bytes > 4 * 1024 * 1024) abort();
            else chunks.push(chunk);
          });
        }
        child.once('error', abort);
        child.once('close', code => {
          if (settled) return;
          settled = true;
          cleanup();
          if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
          else {
            killGroup();
            reject(
              new GitError({
                outside: Buffer.concat(stderr)
                  .toString('utf8')
                  .includes('not a git repository'),
              }),
            );
          }
        });
        abortSignal.addEventListener('abort', abort, {once: true});
        if (abortSignal.aborted) abort();
      }),
    catch: error =>
      error instanceof GitError ? error : new GitError({outside: false}),
  });
}

function parseStatus(text: string) {
  const result: GitSnapshot = {
    branch: '',
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicts: 0,
    ahead: 0,
    behind: 0,
    operation: '',
  };
  let oid = '';
  const entries = text.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? '';
    if (entry.startsWith('# branch.head ')) result.branch = entry.slice(14);
    else if (entry.startsWith('# branch.oid ')) oid = entry.slice(13);
    else if (entry.startsWith('# branch.ab ')) {
      const counts = /^# branch.ab \+(\d+) -(\d+)$/.exec(entry);
      if (!counts) throw new GitError({outside: false});
      result.ahead = Number(counts[1]);
      result.behind = Number(counts[2]);
    } else if (entry.startsWith('1 ') || entry.startsWith('2 ')) {
      if (!/^[12] [A-Z.]{2} /.test(entry)) throw new GitError({outside: false});
      if (entry[2] !== '.') result.staged++;
      if (entry[3] !== '.') result.modified++;
      if (entry[0] === '2') i++; // A rename's original name is a separate NUL record.
    } else if (entry.startsWith('u ')) result.conflicts++;
    else if (entry.startsWith('? ')) result.untracked++;
    else if (entry && !entry.startsWith('# ') && !entry.startsWith('! ')) {
      throw new GitError({outside: false});
    }
  }
  if (!result.branch) throw new GitError({outside: false});
  if (result.branch === '(detached)')
    result.branch = `detached ${oid.slice(0, 7)}`;
  return result;
}

function operation(gitDirectory: string) {
  return Effect.gen(function* () {
    for (const [marker, label] of [
      ['rebase-merge', 'rebase'],
      ['rebase-apply', 'rebase'],
      ['MERGE_HEAD', 'merge'],
      ['CHERRY_PICK_HEAD', 'cherry-pick'],
      ['REVERT_HEAD', 'revert'],
      ['BISECT_LOG', 'bisect'],
    ]) {
      if (!marker || !label) continue;
      const exists = yield* Effect.tryPromise({
        try: async () => {
          await stat(join(gitDirectory, marker));
          return true;
        },
        catch: error => error,
      }).pipe(
        Effect.catch(error => {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            return Effect.succeed(false);
          return Effect.fail(new GitError({outside: false}));
        }),
      );
      if (exists) return label;
    }
    return '';
  });
}

/** One bounded local snapshot. Callers own cancellation and refresh coalescing. */
export function readGit(cwd: string, signal: AbortSignal) {
  return Effect.gen(function* () {
    const directory = (yield* command(
      cwd,
      ['rev-parse', '--absolute-git-dir'],
      signal,
    )).replace(/\n$/, '');
    const raw = yield* command(
      cwd,
      ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'],
      signal,
    );
    const snapshot = yield* Effect.try({
      try: () => parseStatus(raw),
      catch: () => new GitError({outside: false}),
    });
    snapshot.operation = yield* operation(directory);
    return {kind: 'ready' as const, snapshot};
  }).pipe(
    Effect.timeout('5 seconds'),
    Effect.catch(error =>
      Effect.succeed({
        kind:
          error instanceof GitError && error.outside
            ? ('outside' as const)
            : ('unknown' as const),
      }),
    ),
  );
}

export type GitState = Effect.Success<ReturnType<typeof readGit>>;
