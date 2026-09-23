import type {AssistantMessage} from '@earendil-works/pi-ai';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';

interface ThinkingInterval {
  elapsed: number;
  started: number | undefined;
}

interface ThinkingRun {
  readonly seconds: number | undefined;
  running: boolean;
}

// Timings belong to observed message objects, never persisted messages or text.
export class ThinkingTimes {
  private messages = new WeakMap<
    AssistantMessage,
    Map<number, ThinkingInterval>
  >();
  private current: Map<number, ThinkingInterval> | undefined;
  private active: ThinkingInterval | undefined;

  constructor(pi: ExtensionAPI) {
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
