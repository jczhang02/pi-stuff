import type {AssistantMessage} from '@earendil-works/pi-ai';
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
  SessionTreeEvent,
  SessionCompactEvent,
} from '@earendil-works/pi-coding-agent';
import {Option, Schema} from 'effect';

const entryType = 'pi-stuff:thinking-times';
const SavedTimes = Schema.Struct({
  version: Schema.Literal(1),
  timestamp: Schema.Number,
  intervals: Schema.Array(
    Schema.Struct({index: Schema.Number, elapsed: Schema.Number}),
  ),
});

interface ThinkingInterval {
  elapsed: number;
  started: number | undefined;
}

interface ThinkingRun {
  readonly seconds: number | undefined;
  running: boolean;
}

// Streaming uses object identity. A custom entry immediately preceding the
// finalized assistant message retains measured intervals without modifying it.
export class ThinkingTimes {
  private messages = new WeakMap<
    AssistantMessage,
    Map<number, ThinkingInterval>
  >();
  private current: Map<number, ThinkingInterval> | undefined;
  private active: ThinkingInterval | undefined;

  constructor(pi: ExtensionAPI) {
    const restore = (
      _event: SessionStartEvent | SessionTreeEvent | SessionCompactEvent,
      ctx: ExtensionContext,
    ) => {
      this.messages = new WeakMap();
      let pending: typeof SavedTimes.Type | undefined;
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type === 'custom' && entry.customType === entryType) {
          const decoded = Schema.decodeUnknownOption(SavedTimes)(entry.data);
          pending = Option.isSome(decoded) ? decoded.value : undefined;
        } else if (entry.type === 'message') {
          const message = entry.message;
          if (
            pending &&
            message.role === 'assistant' &&
            message.timestamp === pending.timestamp &&
            pending.intervals.every(
              interval =>
                Number.isSafeInteger(interval.index) &&
                interval.index >= 0 &&
                Number.isFinite(interval.elapsed) &&
                interval.elapsed >= 0 &&
                message.content[interval.index]?.type === 'thinking',
            ) &&
            new Set(pending.intervals.map(interval => interval.index)).size ===
              pending.intervals.length
          ) {
            this.messages.set(
              message,
              new Map(
                pending.intervals.map(interval => [
                  interval.index,
                  {elapsed: interval.elapsed, started: undefined},
                ]),
              ),
            );
          }
          pending = undefined;
        }
      }
    };
    pi.on('session_start', restore);
    pi.on('session_tree', restore);
    pi.on('session_compact', restore);
    pi.on('message_start', event => {
      if (event.message.role !== 'assistant') return;
      this.finish();
      this.current = new Map();
    });
    pi.on('message_update', event => {
      if (event.message.role !== 'assistant' || !this.current) return;
      const update = event.assistantMessageEvent;
      if (
        update.type === 'thinking_start' ||
        update.type === 'thinking_delta'
      ) {
        let interval = this.current.get(update.contentIndex);
        if (interval !== this.active || !interval) {
          this.finish();
          interval ??= {elapsed: 0, started: undefined};
          interval.started = performance.now();
          this.current.set(update.contentIndex, interval);
          this.active = interval;
        }
      } else if (update.type === 'thinking_end') {
        if (this.current.get(update.contentIndex) === this.active)
          this.finish();
      } else {
        // Some providers defer thinking_end until the entire response ends.
        // Text/tool output ends the observed thinking segment immediately.
        this.finish();
      }
      this.messages.set(event.message, this.current);
    });
    pi.on('message_end', event => {
      if (event.message.role !== 'assistant' || !this.current) return;
      this.finish();
      this.messages.set(event.message, this.current);
      if (this.current.size > 0)
        pi.appendEntry(entryType, {
          version: 1,
          timestamp: event.message.timestamp,
          intervals: [...this.current].map(([index, interval]) => ({
            index,
            elapsed: interval.elapsed,
          })),
        });
      this.current = undefined;
    });
    pi.on('session_shutdown', () => {
      this.finish();
      this.current = undefined;
      this.messages = new WeakMap();
    });
  }

  private finish(): void {
    if (this.active?.started !== undefined) {
      this.active.elapsed += performance.now() - this.active.started;
      this.active.started = undefined;
    }
    this.active = undefined;
  }

  runs(message: AssistantMessage): ThinkingRun[] {
    const intervals = this.messages.get(message);
    const runs: ThinkingRun[] = [];
    for (let i = 0; i < message.content.length; i++) {
      if (message.content[i]?.type !== 'thinking') continue;
      let visible = false;
      let known = true;
      let elapsed = 0;
      let started: number | undefined;
      for (; i < message.content.length; i++) {
        const block = message.content[i];
        if (block?.type !== 'thinking') break;
        if (!block.thinking.trim()) continue;
        visible = true;
        const interval = intervals?.get(i);
        if (!interval) {
          known = false;
          continue;
        }
        elapsed += interval.elapsed;
        if (interval.started !== undefined) started = interval.started;
      }
      i--;
      if (visible)
        runs.push({
          get seconds() {
            const duration =
              elapsed +
              (started === undefined ? 0 : performance.now() - started);
            return known ? Math.floor(Math.max(0, duration) / 1000) : undefined;
          },
          running: started !== undefined,
        });
    }
    return runs;
  }
}
