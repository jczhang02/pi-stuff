import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent';
import {truncateToWidth, type TUI} from '@earendil-works/pi-tui';
import type {ToolSwitches} from '../tool-switches';
import {SubagentManager} from './runtime';
import {registerSubagentTools} from './tools';
import {decorateEditor} from './ui/editor';
import {Fleet, type AgentView} from './ui/fleet';
import {mainStatusline} from './ui/statusline';
import {openViewer} from './ui/viewer';

type EditorFactory = NonNullable<
  ReturnType<ExtensionContext['ui']['getEditorComponent']>
>;

class Subagents {
  readonly manager: SubagentManager;
  readonly fleet: Fleet;
  private tui: TUI | undefined;
  private data: ReadonlyFooterDataProvider = {
    getGitBranch: () => null,
    getExtensionStatuses: () => new Map(),
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  };
  private previousEditor: EditorFactory | undefined;
  private editorFactory: EditorFactory | undefined;
  private renderTimer: ReturnType<typeof setInterval> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private notices: string[] = [];
  private unsubscribe: (() => void) | undefined;
  private closed = false;
  private opening = false;
  private footerInstalled = false;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly ctx: ExtensionContext,
  ) {
    this.manager = new SubagentManager(pi, {
      notify: text => {
        this.notices.push(text);
        if (!this.noticeTimer)
          this.noticeTimer = setTimeout(() => this.deliver(), 150);
      },
      onSession: (task, session) => this.fleet.observe(task, session),
      report: message => ctx.ui.notify(message, 'error'),
    });
    this.fleet = new Fleet(this.manager);
    this.fleet.context = ctx;
    this.fleet.changed = () => this.tui?.requestRender();
  }

  private deliver(): void {
    this.noticeTimer = undefined;
    if (this.closed || !this.notices.length) return;
    const content = this.notices.splice(0).join('\n\n');
    this.pi.sendMessage(
      {customType: 'pi-stuff-subagent', content, display: false},
      {triggerTurn: true, deliverAs: 'followUp'},
    );
  }

  async start(): Promise<void> {
    await this.manager.restoreFromSidecar(this.ctx);
    if (this.ctx.mode !== 'tui') return;
    const ctx = this.ctx;
    this.previousEditor = ctx.ui.getEditorComponent();
    this.editorFactory = (tui, theme, keys) => {
      const editor =
        this.previousEditor?.(tui, theme, keys) ??
        new CustomEditor(tui, theme, keys, {embedWorkingStatus: true});
      decorateEditor(
        editor,
        () =>
          this.fleet.views().length ? {name: 'main', task: ''} : undefined,
        () => ctx.ui.theme,
      );
      const handle = editor.handleInput.bind(editor);
      editor.handleInput = data => {
        const action = this.fleet.select(data, editor.getText() === '', keys);
        if (action) {
          if (action !== true && action !== 'main') void this.open(action);
          tui.requestRender();
        } else handle(data);
      };
      return editor;
    };
    ctx.ui.setEditorComponent(this.editorFactory);
    this.unsubscribe = this.manager.subscribe(() => {
      this.installFooter();
      this.tui?.requestRender();
    });
    this.installFooter();
    this.renderTimer = setInterval(() => {
      if (
        this.fleet
          .views()
          .some(
            view =>
              !view.task.endedAt ||
              this.manager.compactionStartedAt(
                view.task.runId,
                view.task.id,
              ) !== undefined,
          )
      )
        this.tui?.requestRender();
    }, 500);
  }

  private installFooter(): void {
    if (this.footerInstalled || !this.fleet.views().length) return;
    const ctx = this.ctx;
    this.footerInstalled = true;
    ctx.ui.setFooter((tui, _theme, data) => {
      this.tui = tui;
      this.data = data;
      return {
        invalidate() {},
        render: width => {
          const rows = this.fleet.render(
            width,
            ctx.ui.theme,
            Math.max(2, Math.min(6, tui.terminal.rows - 12)),
          );
          return [
            ...mainStatusline(ctx, data, width),
            ...rows,
            ...(rows.length && this.fleet.focused
              ? [
                  truncateToWidth(
                    ctx.ui.theme.fg(
                      'dim',
                      '↑↓ 选择 · Enter 进入 · x 停止 · Esc 回到输入',
                    ),
                    width,
                    '…',
                  ),
                ]
              : []),
          ];
        },
      };
    });
  }

  async open(view?: AgentView): Promise<void> {
    if (this.ctx.mode !== 'tui' || this.opening || this.closed) return;
    let next = view ?? this.fleet.views()[0];
    if (!next) {
      this.ctx.ui.notify('当前没有子代理任务。', 'info');
      return;
    }
    this.opening = true;
    const draft = this.ctx.ui.getEditorText();
    try {
      while (next && !this.closed) {
        this.fleet.viewing = next;
        next = await openViewer(this.ctx, this.fleet, next, this.data);
      }
    } catch (error) {
      if (!this.closed)
        this.ctx.ui.notify(
          error instanceof Error ? error.message : '无法打开子代理会话。',
          'error',
        );
    } finally {
      this.fleet.viewing = undefined;
      this.fleet.focused = false;
      this.opening = false;
      if (!this.closed) this.ctx.ui.setEditorText(draft);
      this.tui?.requestRender();
    }
  }

  async dispose(): Promise<void> {
    this.closed = true;
    if (this.renderTimer) clearInterval(this.renderTimer);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.notices = [];
    this.unsubscribe?.();
    this.fleet.dispose();
    if (this.ctx.mode === 'tui') {
      if (this.ctx.ui.getEditorComponent() === this.editorFactory)
        this.ctx.ui.setEditorComponent(this.previousEditor);
      if (this.footerInstalled) this.ctx.ui.setFooter(undefined);
    }
    await this.manager.dispose();
  }
}

export function installSubagents(
  pi: ExtensionAPI,
  switches: ToolSwitches | undefined,
): void {
  let current: Subagents | undefined;
  registerSubagentTools(
    pi,
    () => {
      if (!current)
        throw new Error(
          'Subagents are unavailable while the parent session is loading.',
        );
      return current.manager;
    },
    switches,
  );
  pi.on('session_start', async (_event, ctx) => {
    current = new Subagents(pi, ctx);
    await current.start();
  });
  pi.on('tool_execution_start', event => {
    if (current) current.fleet.mainActivity = event.toolName;
  });
  pi.on('agent_start', () => {
    if (current) current.fleet.mainActivity = 'Working';
  });
  pi.on('agent_end', () => {
    if (current) current.fleet.mainActivity = '';
  });
  pi.on('session_shutdown', async () => {
    await current?.dispose();
    current = undefined;
  });
  pi.registerCommand('subagents', {
    description:
      '打开子代理会话；空输入 ↓ 选择，Enter 进入，x 停止，Ctrl+C 返回 main。',
    handler: async (_args, ctx) => {
      if (ctx.mode === 'tui') await current?.open();
      else
        ctx.ui.notify(
          current?.manager
            .listRuns()
            .map(run => `${run.id}: ${run.status}`)
            .join('\n') || 'No subagent runs.',
          'info',
        );
    },
  });
  pi.registerShortcut('ctrl+shift+a', {
    description: '打开子代理会话',
    handler: async () => {
      await current?.open();
    },
  });
}
