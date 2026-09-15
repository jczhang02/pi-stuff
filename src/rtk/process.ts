import {spawn, type ChildProcess} from 'node:child_process';
import {Effect, Schema} from 'effect';

export const RTK_PROCESS_TIMEOUT_MS = 5000;
export const RTK_PROCESS_OUTPUT_BYTES = 256 * 1024;

export class RtkProcessError extends Schema.TaggedError<RtkProcessError>()(
  'RtkProcessError',
  {
    kind: Schema.Literals(['aborted', 'output', 'spawn', 'timeout']),
    message: Schema.String,
  },
) {}

export interface RtkProcessResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface OutputAppendResult {
  bytes: number;
  overflow: boolean;
}

function killProcess(child: ChildProcess): void {
  try {
    if (child.pid !== undefined && process.platform !== 'win32')
      process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    // The process may have exited between the close check and the kill.
  }
}

function appendOutput(
  chunks: Buffer[],
  currentBytes: number,
  chunk: Buffer,
  limit: number,
): OutputAppendResult {
  const available = limit - currentBytes;
  if (available <= 0) return {bytes: currentBytes, overflow: true};
  const kept = chunk.subarray(0, Math.min(available, chunk.byteLength));
  chunks.push(kept);
  return {
    bytes: currentBytes + kept.byteLength,
    overflow: kept.byteLength < chunk.byteLength,
  };
}

function spawnProcess(
  executable: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<RtkProcessResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new RtkProcessError({
          kind: 'aborted',
          message: 'RTK process execution was cancelled.',
        }),
      );
      return;
    }

    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        cwd,
        detached: true,
        env: {...process.env},
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      reject(
        new RtkProcessError({
          kind: 'spawn',
          message: `Could not start RTK executable: ${executable}`,
        }),
      );
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abort);
    };
    const fail = (error: RtkProcessError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code: code ?? -1,
      });
    };
    const terminate = (error: RtkProcessError) => {
      if (settled) return;
      killProcess(child);
      fail(error);
    };
    const abort = () => {
      terminate(
        new RtkProcessError({
          kind: 'aborted',
          message: 'RTK process execution was cancelled.',
        }),
      );
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const result = appendOutput(
        stdout,
        stdoutBytes,
        chunk,
        RTK_PROCESS_OUTPUT_BYTES,
      );
      stdoutBytes = result.bytes;
      if (result.overflow)
        terminate(
          new RtkProcessError({
            kind: 'output',
            message: 'RTK process output exceeded the safety limit.',
          }),
        );
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const result = appendOutput(
        stderr,
        stderrBytes,
        chunk,
        RTK_PROCESS_OUTPUT_BYTES,
      );
      stderrBytes = result.bytes;
      if (result.overflow)
        terminate(
          new RtkProcessError({
            kind: 'output',
            message: 'RTK process output exceeded the safety limit.',
          }),
        );
    });
    child.once('error', error => {
      fail(
        new RtkProcessError({
          kind: 'spawn',
          message:
            error instanceof Error
              ? `Could not start RTK executable: ${error.message}`
              : 'Could not start RTK executable.',
        }),
      );
    });
    child.once('close', finish);
    timeout = setTimeout(
      () =>
        terminate(
          new RtkProcessError({
            kind: 'timeout',
            message: `RTK process exceeded the ${timeoutMs} ms timeout.`,
          }),
        ),
      timeoutMs,
    );
    if (signal) {
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) abort();
    }
  });
}

export function runRtkProcess(
  executable: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = RTK_PROCESS_TIMEOUT_MS,
): Effect.Effect<RtkProcessResult, RtkProcessError> {
  return Effect.tryPromise({
    try: () => spawnProcess(executable, args, cwd, signal, timeoutMs),
    catch: error =>
      error instanceof RtkProcessError
        ? error
        : new RtkProcessError({
            kind: 'spawn',
            message: 'Could not start RTK executable.',
          }),
  });
}
