import {randomUUID} from 'node:crypto';
import {watch as watchDirectory, type FSWatcher} from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {Effect, Schema} from 'effect';
import {executorIdentity, inspectExecutions} from './processes';
import {FleetRecord} from './records';

export class StoreError extends Schema.TaggedError<StoreError>()('StoreError', {
  message: Schema.String,
}) {}

export interface ExecutorOwner {
  readonly pid: number;
  readonly boot: string;
  readonly started: string;
  readonly nonce: string;
  readonly sessionId: string;
}

export type OwnerStatus = 'none' | 'active' | 'dead' | 'unknown' | 'changed';
export type ExecutionStatus = 'clear' | 'active' | 'unknown';
export type RecoveryStatus =
  | 'fresh'
  | 'writer'
  | 'recovered'
  | 'observer'
  | 'blocked';

export interface RecoveryMetadata {
  readonly status: RecoveryStatus;
  readonly previousOwner: ExecutorOwner | null;
  readonly ownerStatus: OwnerStatus;
  readonly executionStatus: ExecutionStatus;
  readonly activeAgentIds: readonly string[];
  readonly unknownAgentIds: readonly string[];
  readonly interruptedAgentIds: readonly string[];
  readonly reason: string | null;
}

const OwnerSchema = Schema.Struct({
  pid: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  boot: Schema.String,
  started: Schema.String,
  nonce: Schema.String,
  sessionId: Schema.String,
});
type OwnerValue = typeof OwnerSchema.Type;

const RecordJson = Schema.fromJsonString(FleetRecord);
const missing = Schema.is(Schema.Struct({code: Schema.Literal('ENOENT')}));
const exists = Schema.is(Schema.Struct({code: Schema.Literal('EEXIST')}));
const recoveryDirectoryName = 'recovery.lock';
const ownerFileName = 'owner.json';

interface ExecutionScan {
  readonly activeAgentIds: readonly string[];
  readonly unknownAgentIds: readonly string[];
  readonly unreadable: boolean;
}

interface LoadedRecord {
  readonly record: FleetRecord;
  readonly present: boolean;
}

interface OwnerSnapshot {
  readonly owner: OwnerValue;
  readonly text: string;
}

interface RecoveryGuard {
  readonly release: () => Promise<void>;
}

function storeError(error: Error | string): StoreError {
  return new StoreError({
    message: error instanceof Error ? error.message : error,
  });
}

function errorMessage(error: Error | string): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyRecord(sessionId: string): FleetRecord {
  return {
    version: 1,
    sessionId,
    revision: 0,
    storageError: null,
    agents: [],
    tasks: [],
    dispatches: [],
    messages: [],
    notices: [],
  };
}

function decodeOwner(text: string): OwnerValue {
  const owner = Schema.decodeUnknownSync(Schema.fromJsonString(OwnerSchema))(
    text,
  );
  if (
    owner.boot.length === 0 ||
    owner.started.length === 0 ||
    owner.nonce.length === 0 ||
    owner.sessionId.length === 0
  )
    throw new Error('Executor owner identity is incomplete.');
  return owner;
}

function encodeOwner(owner: OwnerValue): string {
  return JSON.stringify(owner);
}

function assertOwnerSession(owner: OwnerValue, sessionId: string): void {
  if (owner.sessionId !== sessionId)
    throw new Error('Executor owner belongs to another parent session.');
}

function decodeRecord(text: string): FleetRecord {
  return Schema.decodeUnknownSync(RecordJson, {
    onExcessProperty: 'error',
  })(text);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function currentOwner(sessionId: string): Promise<OwnerValue> {
  const identity = await Effect.runPromise(executorIdentity());
  if (identity === null)
    throw new Error('The executor process identity is unavailable.');
  return {...identity, nonce: randomUUID(), sessionId};
}

async function loadRecord(
  directory: string,
  sessionId: string,
): Promise<LoadedRecord> {
  const path = join(directory, 'records.json');
  const text = await readOptional(path);
  if (text === null) return {record: emptyRecord(sessionId), present: false};
  const record = decodeRecord(text);
  if (record.sessionId !== sessionId)
    throw new Error('Saved fleet belongs to another parent session.');
  return {record, present: true};
}

async function waitForRecord(
  directory: string,
  sessionId: string,
): Promise<LoadedRecord> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const loaded = await loadRecord(directory, sessionId);
    if (loaded.present) return loaded;
    await new Promise<void>(resolve =>
      setTimeout(resolve, 1 << Math.min(attempt, 6)),
    );
  }
  throw new Error('Executor lock exists but fleet records are missing.');
}

async function readOwner(path: string): Promise<OwnerSnapshot | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const text = await readOptional(path);
    if (text === null) return null;
    try {
      return {owner: decodeOwner(text), text};
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise<void>(resolve => setTimeout(resolve, 1));
    }
  }
  throw new Error('Executor owner could not be read.');
}

async function hasEntries(directory: string): Promise<boolean> {
  return (await readdir(directory)).length > 0;
}

async function retainedAgentIds(
  directory: string,
  record: FleetRecord,
): Promise<{ids: readonly string[]; unreadable: boolean}> {
  const ids = new Set([
    ...record.agents.map(agent => agent.id),
    ...record.tasks.map(task => task.agentId),
  ]);
  try {
    const entries = await readdir(join(directory, 'sessions'), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isDirectory()) ids.add(entry.name);
    }
    return {ids: [...ids], unreadable: false};
  } catch (error) {
    if (missing(error)) return {ids: [...ids], unreadable: false};
    return {ids: [...ids], unreadable: true};
  }
}

async function hasUnverifiableLedgerEntries(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path, {withFileTypes: true});
    return entries.some(
      entry => !entry.isFile() || !entry.name.endsWith('.json'),
    );
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function scanExecutions(
  directory: string,
  record: FleetRecord,
): Promise<ExecutionScan> {
  const retained = await retainedAgentIds(directory, record);
  const activeAgentIds: string[] = [];
  const unknownAgentIds: string[] = [];
  for (const agentId of retained.ids) {
    try {
      const ledger = join(directory, 'sessions', agentId, 'processes');
      if (await hasUnverifiableLedgerEntries(ledger)) {
        unknownAgentIds.push(agentId);
        continue;
      }
      const result = await Effect.runPromise(inspectExecutions(ledger));
      if (result.active) activeAgentIds.push(agentId);
      if (result.unknown) unknownAgentIds.push(agentId);
    } catch {
      unknownAgentIds.push(agentId);
    }
  }
  return {
    activeAgentIds,
    unknownAgentIds: retained.unreadable
      ? [...new Set([...unknownAgentIds, ...retained.ids])]
      : unknownAgentIds,
    unreadable: retained.unreadable,
  };
}

function executionStatus(scan: ExecutionScan): ExecutionStatus {
  if (scan.unreadable || scan.unknownAgentIds.length > 0) return 'unknown';
  if (scan.activeAgentIds.length > 0) return 'active';
  return 'clear';
}

function unresolvedAgentIds(record: FleetRecord): readonly string[] {
  return [
    ...new Set(
      record.tasks
        .filter(task => task.phase !== 'ended')
        .map(task => task.agentId),
    ),
  ];
}

function metadata(
  status: RecoveryStatus,
  previousOwner: OwnerValue | null,
  ownerStatus: OwnerStatus,
  scan: ExecutionScan,
  record: FleetRecord,
  reason: string | null,
): RecoveryMetadata {
  const recovered = status === 'recovered';
  return {
    status,
    previousOwner,
    ownerStatus,
    executionStatus: executionStatus(scan),
    activeAgentIds: scan.activeAgentIds,
    unknownAgentIds: scan.unknownAgentIds,
    interruptedAgentIds: recovered ? unresolvedAgentIds(record) : [],
    reason,
  };
}

async function acquireRecovery(
  directory: string,
  ownerText: string,
): Promise<RecoveryGuard | null> {
  const path = join(directory, recoveryDirectoryName);
  try {
    await mkdir(path, {mode: 0o700});
  } catch (error) {
    if (exists(error)) return null;
    throw error;
  }
  const ownerPath = join(path, ownerFileName);
  const file = await open(ownerPath, 'wx', 0o600);
  try {
    await file.writeFile(ownerText);
    await file.sync();
  } finally {
    await file.close();
  }
  await syncDirectory(path);
  return {
    release: async () => {
      const actual = await readOptional(ownerPath);
      if (actual !== ownerText)
        throw new Error('Recovery mutex ownership changed.');
      await unlink(ownerPath);
      await rmdir(path);
      await syncDirectory(directory);
    },
  };
}

async function claimExecutor(
  lockPath: string,
  ownerText: string,
): Promise<boolean> {
  let file;
  try {
    file = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (exists(error)) return false;
    throw error;
  }
  try {
    await file.writeFile(ownerText);
    await file.sync();
  } finally {
    await file.close();
  }
  await syncDirectory(dirname(lockPath));
  return true;
}

async function removeOwnedExecutor(
  lockPath: string,
  ownerText: string,
): Promise<boolean> {
  const actual = await readOptional(lockPath);
  if (actual === null) return false;
  if (actual !== ownerText)
    throw new Error('Another or unknown executor owns this fleet.');
  await unlink(lockPath);
  await syncDirectory(dirname(lockPath));
  return true;
}

async function classifyOwner(owner: OwnerValue): Promise<OwnerStatus> {
  try {
    const identity = await Effect.runPromise(executorIdentity(owner.pid));
    if (identity === null) return 'dead';
    return identity.boot === owner.boot && identity.started === owner.started
      ? 'active'
      : 'dead';
  } catch {
    return 'unknown';
  }
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(text);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    renamed = true;
    await syncDirectory(dirname(path));
  } catch (error) {
    if (!renamed) {
      try {
        await rm(temporary);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    throw error;
  }
}

async function initialEntriesAreSafe(directory: string): Promise<void> {
  if (await hasEntries(directory))
    throw new Error('Fleet records are missing beside existing store data.');
}

async function scanOrUnknown(
  directory: string,
  record: FleetRecord,
): Promise<ExecutionScan> {
  try {
    return await scanExecutions(directory, record);
  } catch {
    return {
      activeAgentIds: [],
      unknownAgentIds: [
        ...new Set([
          ...record.agents.map(agent => agent.id),
          ...record.tasks.map(task => task.agentId),
        ]),
      ],
      unreadable: true,
    };
  }
}

export class FleetStore {
  private closed = false;
  private writableState: boolean;
  private operation: Promise<void> = Promise.resolve();
  private recoveryState: RecoveryMetadata;
  private readonly watchers = new Map<FSWatcher, () => void>();

  private constructor(
    readonly directory: string,
    writable: boolean,
    private readonly lockPath: string,
    private readonly ownerText: string,
    private current: FleetRecord,
    recovery: RecoveryMetadata,
  ) {
    this.writableState = writable;
    this.recoveryState = recovery;
  }

  get writable(): boolean {
    return this.writableState && !this.closed;
  }

  get snapshot(): FleetRecord {
    return this.current;
  }

  get recovery(): RecoveryMetadata {
    return this.recoveryState;
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operation;
    let release!: () => void;
    this.operation = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  static open(directory: string, sessionId: string) {
    return Effect.tryPromise({
      try: () => FleetStore.openStore(directory, sessionId),
      catch: error =>
        Schema.is(StoreError)(error)
          ? error
          : storeError(
              error instanceof Error ? error : 'Cannot open saved fleet.',
            ),
    });
  }

  refresh() {
    return Effect.tryPromise({
      try: () =>
        this.exclusive(async () => {
          if (this.closed) throw new Error('Fleet store is closed.');
          const loaded = await loadRecord(
            this.directory,
            this.current.sessionId,
          );
          if (!loaded.present)
            throw new Error('Fleet records disappeared during refresh.');
          const scan = await scanOrUnknown(this.directory, loaded.record);
          const actual = await readOwner(this.lockPath);
          if (actual !== null)
            assertOwnerSession(actual.owner, this.current.sessionId);
          const recoveryHeld = await pathExists(
            join(this.directory, recoveryDirectoryName),
          );
          if (this.writableState && actual?.text !== this.ownerText) {
            this.writableState = false;
            this.recoveryState = metadata(
              'blocked',
              actual?.owner ?? null,
              actual === null ? 'changed' : await classifyOwner(actual.owner),
              scan,
              loaded.record,
              'Executor ownership was lost during refresh.',
            );
            throw new Error('Executor ownership was lost during refresh.');
          }
          this.current = loaded.record;
          if (this.writableState) {
            this.recoveryState = metadata(
              this.recoveryState.status === 'recovered'
                ? 'recovered'
                : 'writer',
              this.recoveryState.status === 'recovered'
                ? this.recoveryState.previousOwner
                : null,
              this.recoveryState.status === 'recovered'
                ? this.recoveryState.ownerStatus
                : 'none',
              scan,
              loaded.record,
              recoveryHeld ? 'Recovery mutex is held.' : null,
            );
          } else {
            const ownerStatus = actual
              ? await classifyOwner(actual.owner)
              : 'none';
            this.recoveryState = metadata(
              recoveryHeld || executionStatus(scan) !== 'clear'
                ? 'blocked'
                : 'observer',
              actual?.owner ?? null,
              ownerStatus,
              scan,
              loaded.record,
              recoveryHeld
                ? 'Recovery mutex is held; takeover is refused.'
                : executionStatus(scan) !== 'clear'
                  ? 'Retained process execution is active or unverifiable.'
                  : null,
            );
          }
          return this.current;
        }),
      catch: error =>
        storeError(
          error instanceof Error ? error : 'Cannot refresh saved fleet.',
        ),
    });
  }

  save(next: FleetRecord) {
    return Effect.tryPromise({
      try: () =>
        this.exclusive(async () => {
          if (!this.writable) throw new Error('Inspection-only fleet store.');
          if (await pathExists(join(this.directory, recoveryDirectoryName)))
            throw new Error('Fleet recovery is in progress.');
          if (next.sessionId !== this.current.sessionId)
            throw new Error(
              'Cannot save another parent session into this fleet.',
            );
          const nextJson = JSON.stringify(next);
          const currentJson = JSON.stringify(this.current);
          if (
            next.revision < this.current.revision ||
            (next.revision === this.current.revision &&
              nextJson !== currentJson)
          )
            throw new Error('Fleet revision must increase monotonically.');
          const encoded = `${JSON.stringify(next)}\n`;
          decodeRecord(encoded);
          const before = await readFile(
            join(this.directory, 'records.json'),
            'utf8',
          );
          if (
            before !== JSON.stringify(this.current) &&
            before !== `${JSON.stringify(this.current)}\n`
          )
            throw new Error(
              'Fleet records changed on disk. Refresh before saving.',
            );
          const actualOwner = await readOptional(this.lockPath);
          if (actualOwner !== this.ownerText)
            throw new Error('Another or unknown executor owns this fleet.');
          if (next.revision === this.current.revision) return;
          const path = join(this.directory, 'records.json');
          try {
            await writeAtomic(path, encoded);
            const savedText = await readFile(path, 'utf8');
            const saved = decodeRecord(savedText);
            if (
              savedText !== encoded ||
              JSON.stringify(saved) !== nextJson ||
              saved.sessionId !== next.sessionId ||
              saved.revision !== next.revision
            )
              throw new Error('Saved fleet revision could not be verified.');
            this.current = saved;
          } catch (error) {
            try {
              if ((await readOptional(this.lockPath)) === this.ownerText) {
                const recovered = await readOptional(path);
                if (recovered === encoded)
                  this.current = decodeRecord(recovered);
              }
            } catch {
              // Preserve the original save failure.
            }
            throw error;
          }
        }),
      catch: error =>
        storeError(
          error instanceof Error ? error : 'Cannot save fleet records.',
        ),
    });
  }

  close() {
    return Effect.tryPromise({
      try: () =>
        this.exclusive(async () => {
          if (this.closed) return;
          if (!this.writableState) {
            this.closed = true;
            this.closeWatchers();
            return;
          }
          const recoveryText = JSON.stringify({
            owner: this.ownerText,
            nonce: randomUUID(),
          });
          const guard = await acquireRecovery(this.directory, recoveryText);
          if (guard === null)
            throw new Error(
              'Recovery mutex is held; cannot release executor safely.',
            );
          try {
            await removeOwnedExecutor(this.lockPath, this.ownerText);
          } finally {
            await guard.release();
          }
          this.writableState = false;
          this.closed = true;
          this.closeWatchers();
        }),
      catch: error =>
        storeError(
          error instanceof Error ? error : 'Cannot release fleet executor.',
        ),
    });
  }

  watch(
    listener: (snapshot: FleetRecord, recovery: RecoveryMetadata) => void,
    onError?: (error: StoreError) => void,
  ): () => void {
    if (this.closed) throw new Error('Fleet store is closed.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watcher = watchDirectory(this.directory, {persistent: false}, () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void Effect.runPromise(this.refresh())
          .then(() => listener(this.current, this.recoveryState))
          .catch(error => {
            onError?.(
              Schema.is(StoreError)(error) ? error : storeError(String(error)),
            );
          });
      }, 10);
    });
    const stop = () => {
      if (timer !== undefined) clearTimeout(timer);
      watcher.close();
      this.watchers.delete(watcher);
    };
    watcher.on('error', error => {
      onError?.(storeError(error));
    });
    this.watchers.set(watcher, stop);
    return stop;
  }

  private closeWatchers() {
    for (const stop of this.watchers.values()) stop();
    this.watchers.clear();
  }

  private static async openStore(
    directory: string,
    sessionId: string,
  ): Promise<FleetStore> {
    await mkdir(directory, {recursive: true, mode: 0o700});
    const owner = await currentOwner(sessionId);
    const ownerText = encodeOwner(owner);
    const lockPath = join(directory, 'executor.lock');
    const recoveryPath = join(directory, recoveryDirectoryName);
    let loaded = await loadRecord(directory, sessionId);
    let existingLock = await readOwner(lockPath);
    if (existingLock !== null)
      assertOwnerSession(existingLock.owner, sessionId);
    if (!loaded.present) {
      if (existingLock === null) {
        try {
          await initialEntriesAreSafe(directory);
        } catch (error) {
          loaded = await loadRecord(directory, sessionId);
          existingLock = await readOwner(lockPath);
          if (
            !loaded.present &&
            existingLock !== null &&
            (await classifyOwner(existingLock.owner)) === 'active'
          ) {
            loaded = await waitForRecord(directory, sessionId);
            existingLock = await readOwner(lockPath);
            if (existingLock !== null)
              assertOwnerSession(existingLock.owner, sessionId);
          } else if (!loaded.present) {
            throw error;
          }
        }
      } else if ((await classifyOwner(existingLock.owner)) === 'active') {
        loaded = await waitForRecord(directory, sessionId);
        existingLock = await readOwner(lockPath);
        if (existingLock !== null)
          assertOwnerSession(existingLock.owner, sessionId);
      } else {
        throw new Error(
          'Fleet records are missing beside existing executor state.',
        );
      }
    }

    const makeStore = (
      writable: boolean,
      recovery: RecoveryMetadata,
      record = loaded.record,
    ) =>
      new FleetStore(
        directory,
        writable,
        lockPath,
        ownerText,
        record,
        recovery,
      );

    const scan = await scanOrUnknown(directory, loaded.record);
    if (await pathExists(recoveryPath))
      return makeStore(
        false,
        metadata(
          'blocked',
          null,
          'unknown',
          scan,
          loaded.record,
          'Recovery mutex exists; execution takeover is refused.',
        ),
      );

    if (existingLock === null) {
      if (executionStatus(scan) !== 'clear')
        return makeStore(
          false,
          metadata(
            'blocked',
            null,
            'none',
            scan,
            loaded.record,
            'Retained process execution is active or unverifiable.',
          ),
        );
      const claimed = await claimExecutor(lockPath, ownerText);
      if (!claimed) {
        loaded = await waitForRecord(directory, sessionId);
        const raced = await readOwner(lockPath);
        if (raced !== null) assertOwnerSession(raced.owner, sessionId);
        return makeStore(
          false,
          metadata(
            'observer',
            raced === null ? null : raced.owner,
            raced === null ? 'changed' : 'active',
            await scanOrUnknown(directory, loaded.record),
            loaded.record,
            'Another executor claimed the fleet during open.',
          ),
        );
      }
      const fresh = !loaded.present;
      if (fresh) {
        try {
          loaded = await loadRecord(directory, sessionId);
          if (!loaded.present) {
            const initial = emptyRecord(sessionId);
            await writeAtomic(
              join(directory, 'records.json'),
              `${JSON.stringify(initial)}\n`,
            );
            loaded = {
              record: initial,
              present: true,
            };
          }
        } catch (error) {
          try {
            await removeOwnedExecutor(lockPath, ownerText);
          } catch (cleanupError) {
            throw new Error(
              errorMessage(error instanceof Error ? error : String(error)) +
                ' Executor lock cleanup failed: ' +
                errorMessage(
                  cleanupError instanceof Error
                    ? cleanupError
                    : String(cleanupError),
                ),
            );
          }
          throw error;
        }
      }
      return makeStore(
        true,
        metadata(
          fresh ? 'fresh' : 'writer',
          null,
          'none',
          scan,
          loaded.record,
          null,
        ),
      );
    }

    const previousOwner = existingLock.owner;
    const previousStatus = await classifyOwner(previousOwner);
    if (previousStatus !== 'dead')
      return makeStore(
        false,
        metadata(
          'observer',
          previousOwner,
          previousStatus,
          scan,
          loaded.record,
          previousStatus === 'unknown'
            ? 'Executor identity is unverifiable; takeover is refused.'
            : 'Another executor owns this fleet.',
        ),
      );
    if (executionStatus(scan) !== 'clear')
      return makeStore(
        false,
        metadata(
          'blocked',
          previousOwner,
          'dead',
          scan,
          loaded.record,
          'A dead owner left active or unverifiable retained execution.',
        ),
      );

    const recoveryText = JSON.stringify({
      owner: ownerText,
      nonce: randomUUID(),
    });
    const guard = await acquireRecovery(directory, recoveryText);
    if (guard === null)
      return makeStore(
        false,
        metadata(
          'blocked',
          previousOwner,
          'dead',
          scan,
          loaded.record,
          'Recovery mutex is stale or held; takeover is refused.',
        ),
      );
    try {
      const reread = await readOwner(lockPath);
      if (reread !== null) assertOwnerSession(reread.owner, sessionId);
      if (reread === null || reread.text !== existingLock.text)
        return makeStore(
          false,
          metadata(
            'observer',
            reread === null ? null : reread.owner,
            'changed',
            scan,
            loaded.record,
            'Executor ownership changed during stale-lock recovery.',
          ),
        );
      const status = await classifyOwner(reread.owner);
      if (status !== 'dead')
        return makeStore(
          false,
          metadata(
            'observer',
            previousOwner,
            status,
            scan,
            loaded.record,
            'Executor became active during recovery.',
          ),
        );
      const rereadScan = await scanOrUnknown(directory, loaded.record);
      if (executionStatus(rereadScan) !== 'clear')
        return makeStore(
          false,
          metadata(
            'blocked',
            previousOwner,
            'dead',
            rereadScan,
            loaded.record,
            'Retained process execution became active or unverifiable during recovery.',
          ),
        );
      await unlink(lockPath);
      await syncDirectory(directory);
      if (!(await claimExecutor(lockPath, ownerText)))
        throw new Error('Executor claim raced during stale-lock recovery.');
      return makeStore(
        true,
        metadata(
          'recovered',
          previousOwner,
          'dead',
          rereadScan,
          loaded.record,
          'Recovered a dead executor lock.',
        ),
      );
    } finally {
      await guard.release();
    }
  }
}
