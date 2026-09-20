import {expect, test} from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {executorIdentity} from '../../src/subagent/processes';
import {FleetStore, type ExecutorOwner} from '../../src/subagent/store';

const openStore = (directory: string, sessionId = 'session-1') =>
  Effect.runPromise(FleetStore.open(directory, sessionId));

async function saveRevision(
  store: FleetStore,
  revision = store.snapshot.revision + 1,
) {
  await Effect.runPromise(store.save({...store.snapshot, revision}));
}

async function writeDeadLock(directory: string, sessionId = 'session-1') {
  const identity = await Effect.runPromise(executorIdentity());
  if (identity === null)
    throw new Error('The test process identity is unavailable.');
  const owner: ExecutorOwner = {
    pid: 2147483647,
    boot: identity.boot,
    started: 'stale-process-start',
    nonce: 'stale-owner',
    sessionId,
  };
  await writeFile(
    join(directory, 'executor.lock'),
    JSON.stringify(owner),
    'utf8',
  );
}

async function temporaryStore() {
  return mkdtemp(join(tmpdir(), 'pi-subagent-store-'));
}

test('simultaneous opens elect one writer and preserve the durable record', async () => {
  const directory = await temporaryStore();
  let first: FleetStore | undefined;
  let second: FleetStore | undefined;
  try {
    [first, second] = await Promise.all([
      openStore(directory),
      openStore(directory),
    ]);
    expect([first.writable, second.writable].filter(Boolean)).toHaveLength(1);
    const writer = first.writable ? first : second;
    const observer = first.writable ? second : first;
    expect(writer.writable).toBe(true);
    expect(observer.writable).toBe(false);
    await saveRevision(writer);
    await Effect.runPromise(observer.refresh());
    expect(observer.snapshot.revision).toBe(1);
  } finally {
    await Promise.all(
      [first, second]
        .filter((store): store is FleetStore => store !== undefined)
        .map(store => Effect.runPromise(store.close())),
    );
    await rm(directory, {recursive: true, force: true});
  }
});

test('readonly observers cannot save and can watch another writer refresh', async () => {
  const directory = await temporaryStore();
  let writer: FleetStore | undefined;
  let observer: FleetStore | undefined;
  let stop: (() => void) | undefined;
  try {
    writer = await openStore(directory);
    observer = await openStore(directory);
    expect(observer.writable).toBe(false);
    await expect(saveRevision(observer)).rejects.toThrow('Inspection-only');

    const update = Promise.withResolvers<number>();
    stop = observer.watch(snapshot => update.resolve(snapshot.revision));
    await saveRevision(writer);
    await expect(update.promise).resolves.toBe(1);
  } finally {
    stop?.();
    await Promise.all(
      [writer, observer]
        .filter((store): store is FleetStore => store !== undefined)
        .map(store => Effect.runPromise(store.close())),
    );
    await rm(directory, {recursive: true, force: true});
  }
});

test('clean close and reopen retain revision counts without resetting the store', async () => {
  const directory = await temporaryStore();
  try {
    const first = await openStore(directory);
    await saveRevision(first, 7);
    await Effect.runPromise(first.close());
    await Effect.runPromise(first.close());

    const second = await openStore(directory);
    expect(second.writable).toBe(true);
    expect(second.recovery.status).toBe('writer');
    expect(second.snapshot.revision).toBe(7);
    await saveRevision(second, 8);
    await Effect.runPromise(second.close());
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('dead executor identity is recovered under a mutex without resetting records', async () => {
  const directory = await temporaryStore();
  try {
    const first = await openStore(directory);
    await saveRevision(first, 3);
    await Effect.runPromise(first.close());
    await writeDeadLock(directory);

    const recovered = await openStore(directory);
    expect(recovered.writable).toBe(true);
    expect(recovered.recovery.status).toBe('recovered');
    expect(recovered.recovery.previousOwner?.pid).toBe(2147483647);
    expect(recovered.snapshot.revision).toBe(3);
    expect(await readdir(directory)).not.toContain('recovery.lock');
    await Effect.runPromise(recovered.close());
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('a reused PID with a different start identity cannot retain ownership', async () => {
  const directory = await temporaryStore();
  try {
    const first = await openStore(directory);
    await Effect.runPromise(first.close());
    const identity = await Effect.runPromise(executorIdentity());
    if (identity === null)
      throw new Error('The test process identity is unavailable.');
    await writeFile(
      join(directory, 'executor.lock'),
      JSON.stringify({
        pid: process.pid,
        boot: identity.boot,
        started: 'different-start-time',
        nonce: 'reused-pid',
        sessionId: 'session-1',
      }),
    );

    const recovered = await openStore(directory);
    expect(recovered.writable).toBe(true);
    expect(recovered.recovery.status).toBe('recovered');
    await Effect.runPromise(recovered.close());
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('an unverifiable recovery mutex fails closed and leaves the stale lock intact', async () => {
  const directory = await temporaryStore();
  try {
    const first = await openStore(directory);
    await Effect.runPromise(first.close());
    await writeDeadLock(directory);
    await mkdir(join(directory, 'recovery.lock'));

    const observer = await openStore(directory);
    expect(observer.writable).toBe(false);
    expect(observer.recovery.status).toBe('blocked');
    expect(await readFile(join(directory, 'executor.lock'), 'utf8')).toContain(
      'stale-owner',
    );
    await Effect.runPromise(observer.close());
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('malformed records fail visibly and preserve the original file', async () => {
  const directory = await temporaryStore();
  const malformed = '{"version":1,"unexpected":true}\n';
  try {
    await writeFile(join(directory, 'records.json'), malformed);
    await expect(openStore(directory)).rejects.toThrow();
    expect(await readFile(join(directory, 'records.json'), 'utf8')).toBe(
      malformed,
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('missing records beside an executor witness fail visibly without deleting the witness', async () => {
  const directory = await temporaryStore();
  try {
    await writeDeadLock(directory);
    const owner = await readFile(join(directory, 'executor.lock'), 'utf8');
    await expect(openStore(directory)).rejects.toThrow(
      'Fleet records are missing',
    );
    expect(await readFile(join(directory, 'executor.lock'), 'utf8')).toBe(
      owner,
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('a failed save leaves the last verified record and allows safe reopen', async () => {
  const directory = await temporaryStore();
  try {
    const writer = await openStore(directory);
    await saveRevision(writer, 1);
    await unlink(join(directory, 'executor.lock'));
    await expect(saveRevision(writer, 2)).rejects.toThrow(
      'Another or unknown executor',
    );
    const saved = await readFile(join(directory, 'records.json'), 'utf8');
    expect(saved).toContain('"revision":1');
    await Effect.runPromise(writer.close());

    const reopened = await openStore(directory);
    expect(reopened.snapshot.revision).toBe(1);
    await Effect.runPromise(reopened.close());
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('unknown retained process ledgers block stale executor recovery', async () => {
  const directory = await temporaryStore();
  try {
    const first = await openStore(directory);
    await Effect.runPromise(first.close());
    await mkdir(join(directory, 'sessions', 'agent-1', 'processes'), {
      recursive: true,
    });
    await writeFile(
      join(directory, 'sessions', 'agent-1', 'processes', 'broken.json'),
      '{broken',
    );
    await writeDeadLock(directory);

    const observer = await openStore(directory);
    expect(observer.writable).toBe(false);
    expect(observer.recovery.status).toBe('blocked');
    expect(observer.recovery.executionStatus).toBe('unknown');
    expect(observer.recovery.unknownAgentIds).toContain('agent-1');
    expect(await readdir(directory)).toContain('executor.lock');
    await Effect.runPromise(observer.close());
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
