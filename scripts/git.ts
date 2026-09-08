import {Effect} from 'effect';
import {InputError} from './parse';

// Git runs without a shell, pager or replacement objects. Subprocess failures
// and invalid UTF-8 fail through the same channel.
export function git(directory: string, args: string[], input?: string) {
  return Effect.try({
    try: () => {
      const result = Bun.spawnSync(
        ['git', '--no-pager', '--no-replace-objects', ...args],
        {
          cwd: directory,
          env: {...process.env, GIT_TERMINAL_PROMPT: '0'},
          stdin: input === undefined ? 'ignore' : Buffer.from(input),
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 30_000,
        },
      );
      if (result.exitCode !== 0 || result.signalCode)
        throw new Error('Git command failed.');
      return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(
        result.stdout,
      );
    },
    catch: () => new InputError({message: 'Git command failed.'}),
  });
}
