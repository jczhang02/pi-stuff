import {
  CustomEditor,
  FooterComponent,
  getSelectListTheme,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent';
import {
  isKeyRelease,
  matchesKey,
  truncateToWidth,
} from '@earendil-works/pi-tui';
import {decorateEditor} from './editor';
import {Fleet, type AgentView} from './fleet';

function historyFor(view: AgentView): string[] {
  return (view.session?.messages ?? []).flatMap(message => {
    if (message.role !== 'user') return [];
    if (!Array.isArray(message.content)) return [message.content];
    return [
      message.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n'),
    ];
  });
}

export async function openViewer(
  ctx: ExtensionContext,
  fleet: Fleet,
  view: AgentView,
  footerData: ReadonlyFooterDataProvider,
): Promise<AgentView | undefined> {
  await fleet.load(view);
  return ctx.ui.custom<AgentView | undefined>(
    (tui, theme, keys, done) => {
      const editor = new CustomEditor(
        tui,
        {
          borderColor: text => theme.fg('accent', text),
          selectList: getSelectListTheme(),
        },
        keys,
      );
      let footer = view.session
        ? new FooterComponent(view.session, childFooterData(view, footerData))
        : undefined;
      let bodyRows = 1;
      let closed = false;
      editor.setText(view.draft);
      for (const prompt of historyFor(view)) editor.addToHistory(prompt);
      decorateEditor(
        editor,
        () => ({name: view.task.agent, task: view.task.task}),
        () => ctx.ui.theme,
      );

      const submit = async (value: string): Promise<void> => {
        if (!value.trim() || view.submitting) return;
        if (value.startsWith('/')) {
          const command = value.trim().split(/\s+/)[0];
          if (command === '/help')
            view.notice = '可用命令：/help /stats /compact；Esc 中断或返回。';
          else if (command === '/stats' && view.session) {
            const messages = view.session.messages;
            const users = messages.filter(
              message => message.role === 'user',
            ).length;
            const assistants = messages.filter(
              message => message.role === 'assistant',
            ).length;
            const tools = messages.filter(
              message => message.role === 'toolResult',
            ).length;
            view.notice = `消息 ${messages.length} · 用户 ${users} · 助手 ${assistants} · 工具 ${tools}`;
          } else if (command === '/compact' && view.session) {
            if (
              view.session.isStreaming ||
              view.session.isCompacting ||
              view.submitting
            )
              view.notice = '请等待当前执行结束后再压缩上下文。';
            else {
              view.notice = '正在压缩上下文……';
              void view.session
                .compact()
                .then(() => {
                  view.notice = '上下文已压缩；完整对话仍可翻阅。';
                  tui.requestRender();
                })
                .catch(error => {
                  view.notice =
                    error instanceof Error ? error.message : '压缩失败。';
                  tui.requestRender();
                });
            }
          } else {
            view.notice = `未知的子代理命令：${command}。`;
            if (!editor.getText()) editor.setText(value);
          }
          tui.requestRender();
          return;
        }
        editor.disableSubmit = true;
        tui.requestRender();
        const accepted = await fleet.send(view, value);
        if (accepted) {
          editor.addToHistory(value);
          if (editor.getText() === value) editor.setText('');
        } else if (!editor.getText()) {
          editor.setText(value);
        }
        view.submitting = false;
        editor.disableSubmit = false;
        tui.requestRender();
      };
      editor.onSubmit = value => {
        void submit(value).catch(error => {
          view.notice = error instanceof Error ? error.message : '发送失败。';
          view.submitting = false;
          editor.disableSubmit = false;
          tui.requestRender();
        });
      };

      const component = {
        focused: true,
        invalidate() {
          editor.invalidate();
          footer?.invalidate();
        },
        dispose() {
          if (closed) return;
          closed = true;
          view.draft = editor.getText();
          view.transcript?.detach();
          footer?.dispose();
          if (fleet.closeViewer === close) fleet.closeViewer = undefined;
        },
        render(width: number): string[] {
          if (width < 50 || tui.terminal.rows < 18) {
            return [
              truncateToWidth(
                theme.fg(
                  'warning',
                  '至少需要 50 列 × 18 行；Ctrl+C 返回 main。',
                ),
                width,
                '…',
              ),
            ];
          }
          editor.focused = !fleet.focused;
          editor.disableSubmit = view.submitting;
          if (view.session && !footer)
            footer = new FooterComponent(
              view.session,
              childFooterData(view, footerData),
            );
          if (view.session && footer) footer.setSession(view.session);
          const footerLines = footer?.render(width) ?? [];
          const fleetLines = fleet.render(width, theme);
          const help = theme.fg(
            'muted',
            fleet.focused
              ? '↑↓ 选择 · Enter 进入 · x 停止 · Esc 回到输入'
              : 'Enter 发送 · 空输入 ↓ 选择代理 · Ctrl+C 返回 main · Esc 中断/返回',
          );
          const bottom = [
            ...editor.render(width),
            ...footerLines,
            '',
            ...fleetLines,
            help,
            ...(view.notice ? [theme.fg('warning', view.notice)] : []),
          ];
          bodyRows = Math.max(1, tui.terminal.rows - bottom.length);
          view.transcript?.attach(tui);
          const transcript =
            view.transcript?.render(width, view.expanded) ?? [];
          view.scroll = Math.min(
            view.scroll,
            Math.max(0, transcript.length - bodyRows),
          );
          const end = transcript.length - view.scroll;
          const body = transcript.slice(Math.max(0, end - bodyRows), end);
          while (body.length < bodyRows) body.push('');
          return [...body, ...bottom].map(line =>
            truncateToWidth(line, width, '…'),
          );
        },
        handleInput(data: string) {
          if (isKeyRelease(data)) return;
          const action = fleet.select(data, editor.getText() === '', keys);
          if (action) {
            if (action !== true) done(action === 'main' ? undefined : action);
          } else if (matchesKey(data, 'ctrl+c')) {
            done(undefined);
          } else if (matchesKey(data, 'escape')) {
            if (view.session?.isCompacting) view.session.abortCompaction();
            else if (
              ['starting', 'running', 'awaiting_parent', 'queued'].includes(
                view.task.status,
              )
            )
              fleet.stop(view);
            else done(undefined);
          } else if (keys.matches(data, 'app.tools.expand')) {
            view.expanded = !view.expanded;
          } else if (matchesKey(data, 'pageUp')) {
            view.scroll += Math.max(1, bodyRows - 2);
          } else if (matchesKey(data, 'pageDown')) {
            view.scroll = Math.max(0, view.scroll - bodyRows + 2);
          } else if (matchesKey(data, 'ctrl+end')) {
            view.scroll = 0;
          } else {
            editor.handleInput(data);
          }
          tui.requestRender();
        },
      };
      function close(): void {
        done(undefined);
      }
      fleet.viewing = view;
      fleet.closeViewer = close;
      return component;
    },
    {
      overlay: true,
      overlayOptions: {
        width: '100%',
        maxHeight: '100%',
        anchor: 'top-left',
        margin: 0,
      },
    },
  );
}

function childFooterData(
  view: AgentView,
  parent: ReadonlyFooterDataProvider,
): ReadonlyFooterDataProvider {
  return {
    getGitBranch: () => view.task.branch ?? parent.getGitBranch(),
    getExtensionStatuses: () => parent.getExtensionStatuses(),
    getAvailableProviderCount: () => parent.getAvailableProviderCount(),
    onBranchChange: callback => parent.onBranchChange(callback),
  };
}
