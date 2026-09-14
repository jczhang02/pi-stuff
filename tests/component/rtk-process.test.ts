import {expect, test} from 'bun:test';
import {mkdtemp, rm, writeFile, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {RtkProcessError, runRtkProcess} from '../../src/rtk/process';

async function makeDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pi-stuff-rtk-process-'));
}

async function waitForFile(path: string, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}.`);
}

test('RTK process cancellation kills descendants before delayed side effects', async () => {
  const directory = await makeDirectory();
  try {
    const started = join(directory, 'started');
    const late = join(directory, 'late');
    const script = join(directory, 'hang');
    await writeFile(
      script,
      `#!/bin/sh
printf started > "$1"
(sleep 1; printf late > "$2") &
sleep 30
`,
      {mode: 0o700},
    );
    const controller = new AbortController();
    const pending = Effect.runPromise(
      runRtkProcess(script, [started], directory, controller.signal, 5_000),
    );
    await waitForFile(started);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(RtkProcessError);
    await expect(pending).rejects.toMatchObject({kind: 'aborted'});
    await new Promise<void>(resolve => setTimeout(resolve, 1_250));
    await expect(access(late)).rejects.toThrow();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('RTK process timeout rejects instead of returning a partial result', async () => {
  const directory = await makeDirectory();
  try {
    const script = join(directory, 'timeout');
    await writeFile(
      script,
      `#!/bin/sh
sleep 30
`,
      {mode: 0o700},
    );
    await expect(
      Effect.runPromise(runRtkProcess(script, [], directory, undefined, 40)),
    ).rejects.toMatchObject({kind: 'timeout'});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('RTK process output overflow rejects instead of truncating', async () => {
  const directory = await makeDirectory();
  try {
    const script = join(directory, 'overflow');
    await writeFile(
      script,
      `#!/bin/sh
dd if=/dev/zero bs=262144 count=2 2>/dev/null
`,
      {mode: 0o700},
    );
    await expect(
      Effect.runPromise(runRtkProcess(script, [], directory, undefined, 5_000)),
    ).rejects.toMatchObject({kind: 'output'});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
