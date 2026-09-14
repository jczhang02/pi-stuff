/**
 * Throwaway Pi extension prototype.
 *
 * Pi owns the editor, footer, theme and keybinding manager. This extension
 * only supplies the in-memory task list/detail component through ctx.ui.custom.
 */

import {
  DynamicBorder,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Container,
  SelectList,
  Spacer,
  Text,
  type Component,
  type KeyId,
  type SelectItem,
  type SelectListTheme,
  type TUI,
} from '@earendil-works/pi-tui';

type TaskStatus = 'running' | 'done';
type TaskScreen = 'list' | 'detail';

interface Task {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly summary: string;
  readonly started: string;
  readonly files: readonly string[];
  readonly activity: readonly string[];
  readonly findings: readonly string[];
}

const tasks: readonly Task[] = [
  {
    id: 'investigate-task-lifecycle',
    title: 'Investigate task lifecycle',
    status: 'running',
    summary: 'Tracing the task handoff in src/web/register.ts',
    started: 'started 2m ago',
    files: ['src/web/register.ts', 'src/web/tools.ts'],
    activity: [
      'Reading src/web/register.ts',
      'Comparing task status events',
      'Waiting on the next step',
    ],
    findings: [],
  },
  {
    id: 'review-task-center',
    title: 'Review task center',
    status: 'done',
    summary: 'Checked the list/detail flow and draft restoration',
    started: 'completed 1m ago',
    files: ['src/web/register.ts', 'prototype/subagent-task-center.ts'],
    activity: [],
    findings: [
      'Task list opens from the extension shortcut',
      'Selection preserves task status and result',
      'Returning restores the same editor draft',
    ],
  },
];

const MIN_WIDTH = 72;
// The detail plus the real Pi input dock/footer fits at 72x24.
const MIN_ROWS = 24;
const THEME_PROBE_ENV = 'PI_TASK_CENTER_THEME_PROBE';

function statusLabel(status: TaskStatus): string {
  return status === 'running' ? 'RUNNING' : 'DONE';
}

function statusIcon(status: TaskStatus): string {
  return status === 'running' ? '●' : '✓';
}

function statusColor(status: TaskStatus): 'accent' | 'success' {
  return status === 'running' ? 'accent' : 'success';
}

function selectTheme(theme: Theme): SelectListTheme {
  return {
    selectedPrefix: text => theme.fg('accent', text),
    selectedText: text => theme.fg('accent', theme.bold(text)),
    description: text => theme.fg('muted', text),
    scrollInfo: text => theme.fg('dim', text),
    noMatch: text => theme.fg('warning', text),
  };
}

function taskItems(): SelectItem[] {
  return tasks.map(task => ({
    value: task.id,
    label: `${task.title}  [${statusLabel(task.status)}]`,
    description: task.summary,
  }));
}

function displayKey(key: KeyId): string {
  return key
    .split('+')
    .map(part => {
      if (part === 'ctrl') return 'Ctrl';
      if (part === 'shift') return 'Shift';
      if (part === 'alt') return 'Alt';
      if (part === 'super') return 'Super';
      if (part === 'escape' || part === 'esc') return 'Esc';
      if (part === 'enter' || part === 'return') return 'Enter';
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join('+');
}

class TaskCenter extends Container implements Component {
  private screen: TaskScreen = 'list';
  private selectedIndex = 0;
  private tooSmall = false;
  private readonly list: SelectList;
  private readonly topBorder: DynamicBorder;
  private readonly bottomBorder: DynamicBorder;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly done: (result: undefined) => void;
  private readonly themeProbeTimer?: ReturnType<typeof setTimeout>;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    done: (result: undefined) => void,
    onThemeProbe: (() => void) | undefined,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.topBorder = new DynamicBorder(text => theme.fg('borderAccent', text));
    this.bottomBorder = new DynamicBorder(text =>
      theme.fg('borderAccent', text),
    );
    this.list = new SelectList(
      taskItems(),
      Math.min(tasks.length, 6),
      selectTheme(theme),
      {minPrimaryColumnWidth: 28, maxPrimaryColumnWidth: 54},
    );
    this.list.onSelectionChange = item => {
      const index = tasks.findIndex(task => task.id === item.value);
      if (index >= 0) this.selectedIndex = index;
    };
    this.list.onSelect = item => {
      const index = tasks.findIndex(task => task.id === item.value);
      if (index >= 0) this.openDetail(index);
    };
    this.list.onCancel = () => this.close();

    if (onThemeProbe) {
      this.themeProbeTimer = setTimeout(onThemeProbe, 900);
    }
    this.rebuild();
  }

  override invalidate(): void {
    this.list.invalidate();
    this.topBorder.invalidate();
    this.bottomBorder.invalidate();
    this.rebuild();
  }

  override render(width: number): string[] {
    const tooSmall = width < MIN_WIDTH || this.tui.terminal.rows < MIN_ROWS;
    if (tooSmall !== this.tooSmall) {
      this.tooSmall = tooSmall;
      this.rebuild();
    }
    return super.render(width);
  }

  handleInput(data: string): void {
    if (this.tooSmall) {
      if (this.keybindings.matches(data, 'tui.select.cancel')) this.close();
      return;
    }

    if (this.screen === 'list') {
      this.handleListInput(data);
      return;
    }

    if (this.keybindings.matches(data, 'tui.select.cancel')) {
      this.screen = 'list';
      this.rebuild();
      this.tui.requestRender(true);
    }
  }

  dispose(): void {
    if (this.themeProbeTimer !== undefined) {
      clearTimeout(this.themeProbeTimer);
    }
  }

  private handleListInput(data: string): void {
    if (this.keybindings.matches(data, 'tui.select.cancel')) {
      this.close();
      return;
    }
    if (this.keybindings.matches(data, 'tui.select.up')) {
      this.moveSelection(-1);
      return;
    }
    if (this.keybindings.matches(data, 'tui.select.down')) {
      this.moveSelection(1);
      return;
    }
    if (this.keybindings.matches(data, 'tui.select.pageUp')) {
      this.moveSelection(-Math.max(1, Math.min(tasks.length, 6)));
      return;
    }
    if (this.keybindings.matches(data, 'tui.select.pageDown')) {
      this.moveSelection(Math.max(1, Math.min(tasks.length, 6)));
      return;
    }
    if (this.keybindings.matches(data, 'tui.select.confirm')) {
      this.openDetail(this.selectedIndex);
    }
  }

  private moveSelection(delta: number): void {
    const next =
      (this.selectedIndex + delta + tasks.length * 10) % tasks.length;
    this.selectedIndex = next;
    this.list.setSelectedIndex(next);
    this.tui.requestRender();
  }

  private openDetail(index: number): void {
    if (!tasks[index]) return;
    this.selectedIndex = index;
    this.screen = 'detail';
    this.rebuild();
    this.tui.requestRender(true);
  }

  private close(): void {
    this.done(undefined);
  }

  private rebuild(): void {
    this.clear();
    this.addChild(this.topBorder);

    if (this.tooSmall) {
      this.addChild(
        new Text(
          `${this.theme.fg('warning', 'Task panel needs more room.')}\n${this.theme.fg('muted', `Resize to at least ${MIN_WIDTH} columns × ${MIN_ROWS} rows.`)}\n\n${this.keyHint('tui.select.cancel', 'back')}`,
          1,
          0,
        ),
      );
      this.addChild(this.bottomBorder);
      return;
    }

    this.addChild(new Text(this.renderHeading(), 1, 0));
    this.addChild(new Spacer(1));
    if (this.screen === 'list') {
      this.addChild(new Text(this.renderListSummary(), 1, 0));
      this.addChild(new Spacer(1));
      this.addChild(this.list);
      this.addChild(new Spacer(1));
      this.addChild(
        new Text(
          `${this.keyHint('tui.select.confirm', 'open')}  ·  ${this.keyHint('tui.select.cancel', 'back')}`,
          1,
          0,
        ),
      );
    } else {
      this.addChild(new Text(this.renderDetail(), 1, 0));
      this.addChild(new Spacer(1));
      this.addChild(
        new Text(this.keyHint('tui.select.cancel', 'back to tasks'), 1, 0),
      );
    }
    this.addChild(this.bottomBorder);
  }

  private renderHeading(): string {
    if (this.screen === 'list') {
      return `${this.theme.bold('Tasks')}  ${this.theme.fg('muted', 'Subagent work')}`;
    }
    const task = tasks[this.selectedIndex];
    return `${this.theme.bold('Tasks')}  ${this.theme.fg('dim', '/')}  ${this.theme.fg('text', task?.title ?? 'Task')}`;
  }

  private renderListSummary(): string {
    const running = tasks.filter(task => task.status === 'running').length;
    const done = tasks.filter(task => task.status === 'done').length;
    return `${this.theme.bold('Task list')}  ${this.theme.fg('muted', `${tasks.length} total · ${running} running · ${done} done`)}`;
  }

  private renderDetail(): string {
    const task = tasks[this.selectedIndex];
    if (!task) return this.theme.fg('warning', 'Task not found.');

    const status = this.theme.fg(
      statusColor(task.status),
      statusLabel(task.status),
    );
    const icon = this.theme.fg(
      statusColor(task.status),
      statusIcon(task.status),
    );
    const lines = [
      `${this.theme.bold(task.title)}  ${status}`,
      `  ${icon} ${this.theme.fg('muted', task.started)}`,
      '',
      this.theme.fg('muted', 'Summary'),
      `  ${this.theme.fg('text', task.summary)}`,
      '',
    ];

    if (task.status === 'running') {
      lines.push(this.theme.fg('muted', 'Latest activity'));
      for (const item of task.activity) {
        lines.push(
          `  ${this.theme.fg('accent', '›')} ${this.theme.fg('text', item)}`,
        );
      }
    } else {
      lines.push(this.theme.fg('muted', 'Findings'));
      for (const finding of task.findings) {
        lines.push(
          `  ${this.theme.fg('success', '✓')} ${this.theme.fg('text', finding)}`,
        );
      }
    }

    lines.push('', this.theme.fg('muted', 'Files'));
    for (const file of task.files) {
      lines.push(`  ${this.theme.fg('border', file)}`);
    }
    return lines.join('\n');
  }

  private keyHint(
    key: 'tui.select.confirm' | 'tui.select.cancel',
    description: string,
  ): string {
    const keys = this.keybindings.getKeys(key).map(displayKey).join(' / ');
    return this.theme.fg('dim', `${keys} ${description}`);
  }
}

async function openTaskCenter(ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== 'tui') {
    ctx.ui.notify('Task center requires the interactive TUI.', 'warning');
    return;
  }

  const probe =
    process.env[THEME_PROBE_ENV] === '1'
      ? () => {
          const nextTheme = ctx.ui.theme.name === 'dark' ? 'light' : 'dark';
          ctx.ui.setTheme(nextTheme);
        }
      : undefined;

  await ctx.ui.custom<void>(
    (tui, theme, keybindings, done) =>
      new TaskCenter(tui, theme, keybindings, done, probe),
  );
}

export default function (pi: ExtensionAPI): void {
  // F12 is not used by Pi's built-in keybinding table or the
  // inspected Ghostty config. It opens the panel without replacing a draft.
  pi.registerShortcut('f12', {
    description: 'Open subagent task center',
    handler: async ctx => {
      await openTaskCenter(ctx);
    },
  });
}
