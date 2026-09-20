// Owns the offline conversation timeline, disclosure state and cancellation.
import {Box, Container, Spacer} from '@earendil-works/pi-tui';
import type {Theme as PiTheme} from '@earendil-works/pi-coding-agent';
import {
  entryComponent,
  expansionFor,
  expandAll,
  type Expansion,
} from './render';
import {repairPlan, followupPlan, type Step} from './live-plan';
import {isExploration, type Entry} from './model';
type Row = {entry: Entry; expansion: Expansion};
export class LiveSession {
  private rows: Row[] = [];
  private steps: Step[] = [];
  private cursor = 0;
  private completedTurns = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Row | undefined;
  private expanded = false;
  private firstFailure: boolean;
  private stopped = false;
  get empty(): boolean {
    return this.rows.length === 0;
  }
  constructor(
    private repaint: () => void,
    failFirstResponse: boolean,
  ) {
    this.firstFailure = failFirstResponse;
  }
  private append(entry: Entry): Row {
    const row = {entry, expansion: expansionFor(entry)};
    expandAll(row.expansion, this.expanded);
    this.rows.push(row);
    this.repaint();
    return row;
  }
  setExpanded(expanded: boolean): void {
    if (expanded === this.expanded) return;
    this.expanded = expanded;
    this.rows.forEach(row => expandAll(row.expansion, expanded));
  }
  submit(text: string): void {
    if (this.stopped || !text.trim()) return;
    if (this.timer) this.cancel();
    this.append({kind: 'user', text});
    if (this.cursor >= this.steps.length) {
      this.steps = this.firstFailure
        ? [{kind: 'thought', text: '检查请求与分页边界.'}, {kind: 'failure'}]
        : this.completedTurns >= 2
          ? [
              {
                kind: 'answer',
                text: '当前改动已覆盖跨页重复、页内重复与全空过滤页. 上一次验证为 10 项测试通过, cursor 保持不变. 本轮没有执行新的工具调用.',
              },
            ]
          : this.completedTurns
            ? followupPlan()
            : repairPlan();
      this.cursor = 0;
      this.firstFailure = false;
    }
    this.next();
  }
  private next(): void {
    const step = this.steps[this.cursor];
    if (!step) {
      this.completedTurns++;
      this.active = undefined;
      return;
    }
    if (step.kind === 'entry') {
      this.append(step.entry);
      this.cursor++;
      this.next();
      return;
    }
    if (step.kind === 'failure') {
      this.append({
        kind: 'status',
        text: 'Request failed: HTTP 503. Please try again.',
        error: true,
      });
      this.steps = [];
      this.cursor = 0;
      return;
    }
    const entry: Entry =
      step.kind === 'tool'
        ? {
            kind: 'tool',
            name: step.tool.name,
            target: step.tool.target,
            state: 'running',
            summary: 'Running · 0s',
            body: {kind: 'text', text: ''},
          }
        : step.kind === 'thought'
          ? {kind: 'thoughts', text: step.text, seconds: 0, running: true}
          : {kind: 'assistant', text: ''};
    const row = this.append(entry);
    this.active = row;
    const started = Date.now();
    const duration =
      step.kind === 'thought'
        ? 2000
        : step.kind === 'answer'
          ? Math.max(1200, step.text.length * 18)
          : 1200;
    this.timer = setInterval(() => {
      const elapsed = Date.now() - started;
      if (entry.kind === 'thoughts') entry.seconds = Math.floor(elapsed / 1000);
      if (entry.kind === 'assistant' && step.kind === 'answer')
        entry.text = Array.from(step.text)
          .slice(
            0,
            Math.ceil(
              Array.from(step.text).length * Math.min(1, elapsed / duration),
            ),
          )
          .join('');
      if (entry.kind === 'tool' && step.kind === 'tool') {
        entry.summary = `Running · ${(elapsed / 1000).toFixed(1)}s`;
        if (entry.name === 'Bash')
          entry.body = {
            kind: 'text',
            text: entry.target.startsWith('bun test')
              ? 'Starting test runner...\nChecking pagination boundaries...'
              : 'Checking whitespace...',
          };
      }
      if (elapsed >= duration) {
        this.clearTimer();
        if (entry.kind === 'thoughts') entry.running = false;
        if (step.kind === 'tool') {
          row.entry = structuredClone(step.tool);
          // Measured replay duration replaces the static fixture's timing.
          row.entry.summary = row.entry.summary.replace(
            / · [\d.]+s$/u,
            ` · ${(elapsed / 1000).toFixed(1)}s`,
          );
          this.fold(row);
        }
        this.active = undefined;
        this.cursor++;
        this.next();
      }
      this.repaint();
    }, 120);
  }
  private fold(row: Row): void {
    const tool = row.entry;
    if (!isExploration(tool)) return;
    const previous = this.rows.at(-2);
    if (!previous) return;
    if (previous.entry.kind === 'explore') {
      previous.entry = {
        kind: 'explore',
        tools: [...previous.entry.tools, tool],
      };
      previous.expansion.children.push(row.expansion);
    } else if (isExploration(previous.entry)) {
      previous.entry = {kind: 'explore', tools: [previous.entry, tool]};
      previous.expansion = {
        open: this.expanded || previous.expansion.open || row.expansion.open,
        children: [previous.expansion, row.expansion],
      };
    } else return;
    this.rows.pop();
  }
  cancel(): boolean {
    if (!this.timer) return false;
    this.clearTimer();
    const entry = this.active?.entry;
    if (entry?.kind === 'thoughts') entry.running = false;
    if (entry?.kind === 'tool') {
      entry.state = 'cancelled';
      entry.summary = 'Cancelled · no completion result';
    }
    this.active = undefined;
    this.append({kind: 'status', text: 'Response interrupted.'});
    return true;
  }
  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  stop(): void {
    this.clearTimer();
    this.stopped = true;
  }
  component(theme: PiTheme): Box {
    const container = new Container();
    for (const row of this.rows) {
      container.addChild(
        entryComponent(row.entry, row.expansion, theme, this.repaint),
      );
      container.addChild(new Spacer(1));
    }
    const box = new Box(1, 0);
    box.addChild(container);
    return box;
  }
}
