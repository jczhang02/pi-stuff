import {Effect} from 'effect';
import type {FleetRecord} from './records';
import type {FleetStore, RecoveryMetadata} from './store';

export interface FleetJournalOptions {
  readonly onPersistenceFailure: (error: Error | string) => void;
  readonly onObserverFailure: (error: Error | string) => void;
}

export type FleetRecordTransform = (record: FleetRecord) => FleetRecord;

/**
 * The only writer for the fleet record.
 *
 * Admission, mailbox delivery and runtime events all use this boundary. The
 * journal serializes their read/transform/save cycle, publishes only after a
 * successful save, and keeps the observer path separate from persistence
 * failures.
 */
export class FleetJournal {
  private current: FleetRecord;
  private serial: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private stopWatching: (() => void) | undefined;
  private healthTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly owned: boolean;

  constructor(
    private readonly store: FleetStore,
    private readonly options: FleetJournalOptions,
  ) {
    this.current = store.snapshot;
    this.owned = store.writable;
  }

  get snapshot(): FleetRecord {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Replace an in-memory observer projection without attempting a write. */
  replaceSnapshot(record: FleetRecord): void {
    this.current = record;
    this.emit();
  }

  startWatching(): void {
    if (this.stopWatching !== undefined) return;
    this.stopWatching = this.store.watch(
      (snapshot, recovery) => {
        if (this.stopWatching === undefined) return;
        const projected = this.projectObserverSnapshot(snapshot, recovery);
        if (projected.revision < this.current.revision) return;
        this.current = projected;
        this.emit();
      },
      error => {
        try {
          if (this.owned) this.options.onPersistenceFailure(error);
          else this.options.onObserverFailure(error);
        } catch {
          /* Store watcher failures must not escape the filesystem callback. */
        }
      },
    );
    if (!this.owned) this.scheduleHealthCheck();
  }

  close(): void {
    if (this.healthTimer !== undefined) clearTimeout(this.healthTimer);
    this.healthTimer = undefined;
    this.stopWatching?.();
    this.stopWatching = undefined;
  }

  update(transform: FleetRecordTransform): Promise<void> {
    const operation = this.serial.then(async () => {
      const next = {
        ...transform(this.current),
        revision: this.current.revision + 1,
      };
      try {
        await Effect.runPromise(this.store.save(next));
      } catch (error) {
        // Rename may have committed the new revision before directory fsync
        // or readback failed. Keep the store's reconciled revision so repair
        // writes advance it; failure handling still prevents any execution.
        if (this.store.snapshot.revision > this.current.revision)
          this.current = this.store.snapshot;
        this.options.onPersistenceFailure(
          error instanceof Error ? error : String(error),
        );
        throw error;
      }
      this.current = next;
      this.emit();
    });
    this.serial = operation.catch(() => {});
    return operation;
  }

  async refresh(): Promise<FleetRecord> {
    const operation = this.serial.then(async () => {
      const next = await Effect.runPromise(this.store.refresh());
      const projected = this.projectObserverSnapshot(next, this.store.recovery);
      if (projected.revision >= this.current.revision) this.current = projected;
      this.emit();
      return next;
    });
    this.serial = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async waitForWrites(): Promise<void> {
    await this.serial;
  }

  retry(): Promise<void> {
    return this.update(record => ({...record, storageError: null}));
  }

  private projectObserverSnapshot(
    snapshot: FleetRecord,
    recovery: RecoveryMetadata,
  ): FleetRecord {
    if (this.owned || recovery.ownerStatus === 'active') return snapshot;
    return {
      ...snapshot,
      tasks: snapshot.tasks.map(task =>
        task.phase === 'ended'
          ? task
          : {
              ...task,
              phase: 'unknown',
              reason:
                task.reason ||
                'Another executor or retained process may still own this task.',
            },
      ),
    };
  }

  private scheduleHealthCheck(): void {
    if (this.owned || this.stopWatching === undefined) return;
    this.healthTimer = setTimeout(() => {
      this.healthTimer = undefined;
      void this.refresh()
        .catch(error => {
          try {
            this.options.onObserverFailure(
              error instanceof Error ? error : String(error),
            );
          } catch {
            /* Observer health failures must not escape the timer. */
          }
        })
        .finally(() => this.scheduleHealthCheck());
    }, 100);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        try {
          this.options.onObserverFailure(
            error instanceof Error ? error : String(error),
          );
        } catch {
          /* Observer failures must never block the durable journal. */
        }
      }
    }
  }
}
