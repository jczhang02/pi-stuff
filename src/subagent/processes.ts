import {spawn} from 'node:child_process';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {mkdir, open, readFile, readdir, rename} from 'node:fs/promises';
import {join} from 'node:path';
import type {BashOperations} from '@earendil-works/pi-coding-agent';
import {Effect, Schema} from 'effect';

const Witness = Schema.Struct({
  pid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  group: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  boot: Schema.String.check(Schema.isMinLength(1)),
  started: Schema.String.check(Schema.isMinLength(1)),
  state: Schema.Literals(['active', 'ended']),
});
type Witness = typeof Witness.Type;
const absent = Schema.is(Schema.Struct({code: Schema.Literal('ENOENT')}));
const vanished = Schema.is(
  Schema.Struct({code: Schema.Literals(['ENOENT', 'ESRCH'])}),
);

async function processIdentity(pid: number) {
  try {
    const text = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    const started = fields[19];
    const group = Number(fields[2]);
    if (!started || !Number.isSafeInteger(group))
      throw new Error('Process identity is unavailable.');
    return {started, group, state: fields[0]};
  } catch (error) {
    if (vanished(error)) return null;
    throw error;
  }
}

async function liveGroup(group: number, excluding?: number) {
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    if (Number(entry) === excluding) continue;
    const identity = await processIdentity(Number(entry));
    if (
      identity?.group === group &&
      identity.state !== 'Z' &&
      identity.state !== 'X'
    )
      return true;
  }
  return false;
}

async function saveWitness(path: string, witness: Witness) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(witness));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const folder = await open(join(path, '..'), 'r');
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
}

// Commands start behind a stdin gate. The durable witness exists before a
// command can change files. No cancellation is reported settled while members
// of the command's process group remain alive. This is lifetime tracking, not an
// OS sandbox: deliberately escaped daemons require external reconciliation.
const executionDirectory = new AsyncLocalStorage<string>();

/** Applies one durable execution ledger to all commands started by an operation. */
export function withExecutionTracking<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T> {
  return executionDirectory.run(directory, operation);
}

interface CommandOptions {
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  onStdout: (data: Buffer) => void;
  onStderr: (data: Buffer) => void;
}

/** Direct argv execution with shared stop/exit semantics for Bash and workspace Git. */
export function trackedCommand(
  executable: string,
  args: readonly string[],
  cwd: string,
  options: CommandOptions,
): Promise<{exitCode: number | null}> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        if (process.platform !== 'linux')
          throw new Error(
            'Tracked child shell execution currently requires Linux process identities.',
          );
        if (options.signal?.aborted)
          throw new Error('Command cancelled before start.');
        const directory = executionDirectory.getStore();
        if (directory) await mkdir(directory, {recursive: true, mode: 0o700});
        const boot = (
          await readFile('/proc/sys/kernel/random/boot_id', 'utf8')
        ).trim();
        const child = spawn(
          '/bin/bash',
          [
            '-c',
            'IFS= read -r gate || exit; "$@" </dev/null; result=$?; printf "%s\\n" "$result" >&3; IFS= read -r release; exit "$result"',
            'pi-subagent-gate',
            executable,
            ...args,
          ],
          {
            cwd,
            env: {...process.env, ...options.env},
            detached: true,
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
          },
        );
        let spawnError: Error | undefined;
        const exited = new Promise<number | null>(resolve => {
          child.once('error', error => {
            spawnError = error;
          });
          child.once('close', code => resolve(code));
        });
        const pid = child.pid;
        if (pid === undefined) {
          await exited;
          throw spawnError ?? new Error('Child process did not start.');
        }
        // Keep the witnessed group leader alive after the command exits. A
        // background grandchild must still receive cancellation through that
        // verified identity, even if it closed stdout and outlived its shell.
        const completion = child.stdio[3];
        const commandFinished = new Promise<void>(resolve => {
          completion?.once('data', () => resolve());
          child.once('exit', () => resolve());
        });
        let witness: Witness | undefined;
        const path = directory ? join(directory, `${randomUUID()}.json`) : null;
        let interrupted = false;
        let signalFailure: Error | undefined;
        let outputFailure: Error | undefined;
        let inputFailure: Error | undefined;
        let witnessed = false;
        let completed = false;
        let signalCompletion: Promise<void> = Promise.resolve();
        const stop = () => {
          if (interrupted) return;
          interrupted = true;
          signalCompletion = processIdentity(pid)
            .then(current => {
              if (witness && current?.started === witness.started)
                process.kill(-pid, 'SIGTERM');
              // An absent/reused leader is not authority to signal another process.
            })
            .catch(error => {
              signalFailure =
                error instanceof Error ? error : new Error(String(error));
            })
            .finally(() => child.stdin.end());
        };
        const output = (data: Buffer, consume: (data: Buffer) => void) => {
          try {
            consume(data);
          } catch (error) {
            outputFailure =
              error instanceof Error ? error : new Error(String(error));
            stop();
          }
        };
        child.stdout.on('data', (data: Buffer) =>
          output(data, options.onStdout),
        );
        child.stderr.on('data', (data: Buffer) =>
          output(data, options.onStderr),
        );
        child.stdin.on('error', error => {
          inputFailure = error;
          stop();
        });
        const timeout =
          options.timeout === undefined
            ? undefined
            : setTimeout(stop, options.timeout * 1000);
        options.signal?.addEventListener('abort', stop, {once: true});
        try {
          const identity = await processIdentity(pid);
          if (!identity || identity.group !== pid)
            throw new Error(
              'Child process identity disappeared before admission.',
            );
          witness = {
            pid,
            group: pid,
            boot,
            started: identity.started,
            state: 'active',
          };
          if (path) {
            await saveWitness(path, witness);
            witnessed = true;
          }
          if (options.signal?.aborted) stop();
          if (interrupted) child.stdin.end();
          else child.stdin.write('start\n');
          await commandFinished;
          while (await liveGroup(pid, pid))
            await new Promise<void>(resolve => setTimeout(resolve, 50));
          if (!interrupted) child.stdin.end('release\n');
          const exitCode = await exited;
          while (await liveGroup(pid))
            await new Promise<void>(resolve => setTimeout(resolve, 50));
          await signalCompletion;
          if (path) await saveWitness(path, {...witness, state: 'ended'});
          completed = true;
          if (spawnError) throw spawnError;
          if (outputFailure) throw outputFailure;
          if (inputFailure) throw inputFailure;
          if (signalFailure) throw signalFailure;
          if (interrupted)
            throw new Error(
              'Command execution cancelled after process-group exit.',
            );
          return {exitCode};
        } finally {
          clearTimeout(timeout);
          options.signal?.removeEventListener('abort', stop);
          if (!completed) {
            stop();
            await signalCompletion;
            await exited;
            while (await liveGroup(pid))
              await new Promise<void>(resolve => setTimeout(resolve, 50));
            if (path && witnessed && witness)
              await saveWitness(path, {...witness, state: 'ended'});
          }
          child.stdin.end();
        }
      },
      catch: error =>
        error instanceof Error ? error : new Error(String(error)),
    }),
  );
}

export function trackedBashOperations(directory: string): BashOperations {
  return {
    exec: (command, cwd, options) =>
      withExecutionTracking(directory, () =>
        trackedCommand('/bin/bash', ['-c', command], cwd, {
          ...options,
          onStdout: options.onData,
          onStderr: options.onData,
        }),
      ),
  };
}

export function inspectExecutions(directory: string) {
  return Effect.tryPromise({
    try: async () => {
      let entries: string[];
      try {
        entries = await readdir(directory);
      } catch (error) {
        if (absent(error)) return {active: false, unknown: false};
        throw error;
      }
      const boot = (
        await readFile('/proc/sys/kernel/random/boot_id', 'utf8')
      ).trim();
      let active = false;
      for (const name of entries.filter(name => name.endsWith('.json'))) {
        const witness = Schema.decodeUnknownSync(
          Schema.fromJsonString(Witness),
        )(await readFile(join(directory, name), 'utf8'));
        if (witness.pid !== witness.group)
          throw new Error('Execution witness has an invalid process group.');
        if (witness.state === 'ended' || witness.boot !== boot) continue;
        if (await liveGroup(witness.group)) active = true;
      }
      return {active, unknown: false};
    },
    catch: error => (error instanceof Error ? error : new Error(String(error))),
  });
}

export function executorIdentity(pid = process.pid) {
  return Effect.tryPromise({
    try: async () => {
      const identity = await processIdentity(pid);
      const boot = (
        await readFile('/proc/sys/kernel/random/boot_id', 'utf8')
      ).trim();
      return identity ? {pid, started: identity.started, boot} : null;
    },
    catch: error => (error instanceof Error ? error : new Error(String(error))),
  });
}
