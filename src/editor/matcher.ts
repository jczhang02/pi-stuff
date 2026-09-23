import {Worker} from 'node:worker_threads';
import {Option, Schema} from 'effect';
import {Match, type EditorSettings} from './settings';
import {skillMatches} from './matches';
const Reply = Schema.Struct({
  text: Schema.String,
  matches: Schema.Array(Match),
});

// User regex never runs on the TUI thread. A stalled request loses only its
// optional keyword colors; input and built-in skill highlighting remain usable.
export class EditorMatcher {
  private worker: Worker | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requested = '';
  private skillText: string | undefined;
  private skills: readonly Match[] = [];
  private retryDelay = 0;
  private cooling = false;
  private completed = '';
  private result: readonly Match[] = [];
  private pending: string | undefined;
  private busy = false;
  private closed = false;
  readonly invalid: number[] = [];
  private readonly keywords: NonNullable<EditorSettings['keywords']>;
  constructor(
    settings: EditorSettings,
    private readonly redraw: () => void,
  ) {
    this.keywords = (settings.keywords ?? []).filter((rule, index) => {
      try {
        new RegExp(rule.pattern, rule.caseSensitive ? 'gu' : 'giu');
        return true;
      } catch {
        this.invalid.push(index + 1);
        return false;
      }
    });
  }
  matches(text: string): readonly Match[] {
    if (text !== this.skillText) {
      this.skillText = text;
      this.skills = skillMatches(text);
    }
    if (!this.keywords.length || this.closed) return this.skills;
    if (text !== this.requested) {
      this.requested = text;
      this.pending = text;
      this.dispatch();
    }
    return text === this.completed ? this.result : this.skills;
  }
  private dispatch() {
    if (this.busy || this.cooling || this.pending === undefined || this.closed)
      return;
    const text = this.pending;
    this.pending = undefined;
    this.busy = true;
    if (!this.worker) {
      const worker = new Worker(new URL('./match-worker.ts', import.meta.url));
      this.worker = worker;
      worker.unref();
      worker.postMessage({keywords: this.keywords});
      worker.on('message', data => {
        if (this.worker !== worker) return;
        const reply = Schema.decodeUnknownOption(Reply)(data);
        if (Option.isSome(reply)) {
          this.completed = reply.value.text;
          this.result = reply.value.matches;
        }
        clearTimeout(this.timer);
        this.busy = false;
        this.retryDelay = 0;
        if (Option.isSome(reply) && reply.value.text === this.requested)
          this.redraw();
        this.dispatch();
      });
      worker.on('error', () => {
        if (this.worker === worker) this.stopWorker();
      });
      worker.once('online', () => {
        if (this.worker !== worker) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.stopWorker(), 200);
      });
      this.timer = setTimeout(() => this.stopWorker(), 5000);
    } else this.timer = setTimeout(() => this.stopWorker(), 200);
    this.worker.postMessage({text});
  }
  private stopWorker() {
    clearTimeout(this.timer);
    const worker = this.worker;
    this.worker = undefined;
    this.busy = false;
    if (this.closed) {
      void worker?.terminate();
      return;
    }
    this.cooling = true;
    this.retryDelay = Math.min(30_000, Math.max(1000, this.retryDelay * 2));
    // Retain only the latest draft, and never overlap retiring/replacement workers.
    void (worker?.terminate() ?? Promise.resolve()).finally(() => {
      if (this.closed) return;
      this.timer = setTimeout(() => {
        this.cooling = false;
        this.dispatch();
      }, this.retryDelay);
    });
  }

  close() {
    this.closed = true;
    this.pending = undefined;
    this.stopWorker();
  }
}
