import {Schema} from 'effect';
import {wrapTextWithAnsi} from '@earendil-works/pi-tui';
import {stripVTControlCharacters} from 'node:util';
import type {Coordinator} from '../coordinator';
import {projectSection} from './sections';
import type {FleetRecord, TaskRecord} from '../records';

export interface ReaderState {
  readonly title: string;
  readonly text: string;
  readonly section: string;
  readonly taskId: string | undefined;
  readonly returnSurface: 'detail';
}

const ReadPage = Schema.Struct({
  text: Schema.String,
  nextOffset: Schema.NullOr(Schema.Number),
});
type ReadPage = typeof ReadPage.Type;

export class ReaderStore {
  private currentState: ReaderState | undefined;
  private readonly fullRecords = new Map<
    string,
    {text: string; source: string}
  >();
  private latestState: ReaderState | undefined;
  private unreadUpdates = 0;
  private queryText = '';
  private following = false;
  private loading = false;

  get current(): ReaderState | undefined {
    return this.currentState;
  }

  get unread(): number {
    return this.unreadUpdates;
  }

  get query(): string {
    return this.queryText;
  }

  get isFollowing(): boolean {
    return this.following;
  }

  get isLoading(): boolean {
    return this.loading;
  }

  open(
    title: string,
    text: string,
    taskId: string | undefined,
    section: string,
  ): void {
    this.currentState = {title, text, taskId, section, returnSurface: 'detail'};
    this.latestState = this.currentState;
    this.unreadUpdates = 0;
    this.queryText = '';
    this.following = false;
  }

  clear(): void {
    this.currentState = undefined;
    this.latestState = undefined;
    this.unreadUpdates = 0;
    this.queryText = '';
    this.following = false;
  }

  setQuery(query: string): void {
    this.queryText = query;
  }

  setFollowing(following: boolean): void {
    this.following = following;
    if (following) {
      this.currentState = this.latestState;
      this.unreadUpdates = 0;
    }
  }

  updateLatest(snapshot: FleetRecord): void {
    if (this.currentState?.taskId === undefined) return;
    const task = snapshot.tasks.find(
      candidate => candidate.id === this.currentState?.taskId,
    );
    if (task === undefined) return;
    const text = this.text(snapshot, task, this.currentState.section);
    if (this.latestState?.text !== text) this.unreadUpdates++;
    this.latestState = {...this.currentState, text};
    if (this.following) {
      this.currentState = this.latestState;
      this.unreadUpdates = 0;
    }
  }

  text(snapshot: FleetRecord, task: TaskRecord, section: string): string {
    const report = this.fullRecords.get(`${task.id}:report`);
    const diff = this.fullRecords.get(`${task.id}:diff`);
    const record = {
      ...task,
      report: report?.source === task.report ? report.text : task.report,
      diff: diff?.source === task.diff ? diff.text : task.diff,
    };
    return projectSection(snapshot, record, section).join('\n');
  }

  lines(width: number): readonly string[] {
    if (this.currentState === undefined) return [];
    return stripVTControlCharacters(this.currentState.text)
      .replaceAll('\r', '')
      .split('\n')
      .flatMap(line => wrapTextWithAnsi(line, Math.max(8, width - 2)));
  }

  findMatch(
    width: number,
    direction: -1 | 1,
    offset: number,
  ): number | undefined {
    const query = this.queryText.toLocaleLowerCase();
    const lines = this.lines(width);
    if (!query || lines.length === 0) return undefined;
    for (let step = 1; step <= lines.length; step++) {
      const index = (offset + direction * step + lines.length) % lines.length;
      if (lines[index]?.toLocaleLowerCase().includes(query)) return index;
    }
    return undefined;
  }

  firstMatch(width: number): number {
    const query = this.queryText.toLocaleLowerCase();
    if (!query) return 0;
    return this.lines(width).findIndex(line =>
      line.toLocaleLowerCase().includes(query),
    );
  }

  async loadFull(
    coordinator: Coordinator,
    task: TaskRecord,
    section: string,
  ): Promise<void> {
    const records: readonly ('report' | 'diff')[] =
      section === 'result' ? ['report', 'diff'] : [];
    if (records.length === 0) return;
    this.loading = true;
    try {
      for (const record of records)
        this.fullRecords.set(`${task.id}:${record}`, {
          text: await this.readAll(coordinator, task.id, record),
          source: task[record],
        });
      if (
        this.currentState?.taskId === task.id &&
        this.currentState.section === section
      ) {
        const latest =
          coordinator.snapshot.tasks.find(
            candidate => candidate.id === task.id,
          ) ?? task;
        this.currentState = {
          ...this.currentState,
          text: this.text(coordinator.snapshot, latest, section),
        };
        this.latestState = this.currentState;
        this.unreadUpdates = 0;
      }
    } finally {
      this.loading = false;
    }
  }

  private async readAll(
    coordinator: Coordinator,
    taskId: string,
    record: 'report' | 'diff',
  ): Promise<string> {
    let offset = 0;
    let text = '';
    for (;;) {
      const result = await coordinator.execute({
        command: 'read',
        taskId,
        record,
        offset,
        length: 16000,
      });
      if (!Schema.is(ReadPage)(result))
        throw new Error('Read operation returned no page.');
      const page: ReadPage = result;
      text += page.text;
      if (page.nextOffset === null) return text;
      if (page.nextOffset <= offset)
        throw new Error('Read operation returned an invalid page cursor.');
      offset = page.nextOffset;
    }
  }
}
