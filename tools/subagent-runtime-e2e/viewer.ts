import {
  CustomEditor,
  FooterComponent,
  getSelectListTheme,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent';
import {isKeyRelease, matchesKey} from '@earendil-works/pi-tui';
import {paint} from '../subagent-ui-prototype/fleet';
import {RuntimeFleet, type AgentView} from './fleet';

export function openViewer(
  ctx: ExtensionContext,
  fleet: RuntimeFleet,
  view: AgentView,
  footerData: ReadonlyFooterDataProvider,
): Promise<AgentView | undefined> {
  return ctx.ui.custom<AgentView | undefined>(
    (tui, theme, keys, done) => {
      const editor = new CustomEditor(
        tui,
        {
          borderColor: text => theme.fg('border', text),
          selectList: getSelectListTheme(),
        },
        keys,
      );
      const footer = new FooterComponent(view.session, footerData);
      let bodyRows = 10;
      editor.setText(view.draft);
      editor.onSubmit = value => {
        if (value.startsWith('/')) {
          view.notice = '会话命令尚不可用。Ctrl+C 返回 main。';
          editor.setText(value);
        } else if (!fleet.send(view, value)) editor.setText(value);
        tui.requestRender();
      };
      return {
        focused: true,
        invalidate() {
          editor.invalidate();
        },
        dispose() {
          view.draft = editor.getText();
          view.transcript.detach();
          footer.dispose();
        },
        render(width: number) {
          if (width < 50 || tui.terminal.rows < 18)
            return [
              paint('至少需要 50 列 × 18 行；Ctrl+C 返回 main。', width, theme),
            ];
          editor.focused = !fleet.focused;
          footer.setSession(view.session);
          const pending = view.session.getSteeringMessages();
          const bottom = [
            theme.fg(
              'accent',
              `发送给 ${view.task.agent}${pending.length ? ' · 补充消息待处理' : ''}`,
            ),
            ...editor.render(width),
            ...footer.render(width),
            '',
            ...fleet.render(width, theme),
            theme.fg(
              'muted',
              fleet.focused
                ? '↑↓ 选择 · Enter 进入 · x 停止 · Esc 回到输入'
                : 'Enter 发送 · 空输入 ↓ 选择代理 · Ctrl+C 返回 main · Esc 中断/返回',
            ),
            ...(view.notice ? [theme.fg('warning', view.notice)] : []),
          ];
          const header = [
            theme.bold(`${view.task.agent}  /  ${view.task.task}`),
            '',
          ];
          bodyRows = Math.max(
            1,
            tui.terminal.rows - bottom.length - header.length,
          );
          view.transcript.attach(tui);
          const lines = view.transcript.render(width, view.expanded);
          view.scroll = Math.min(
            view.scroll,
            Math.max(0, lines.length - bodyRows),
          );
          const end = lines.length - view.scroll;
          const body = lines.slice(Math.max(0, end - bodyRows), end);
          while (body.length < bodyRows) body.push('');
          return [...header, ...body, ...bottom].map(line =>
            paint(line, width, theme),
          );
        },
        handleInput(data: string) {
          if (isKeyRelease(data)) return;
          const action = fleet.select(data, editor.getText() === '');
          if (action) {
            if (action !== true) done(action === 'main' ? undefined : action);
          } else if (matchesKey(data, 'ctrl+c')) done(undefined);
          else if (matchesKey(data, 'escape')) {
            if (view.session.isStreaming) fleet.stop(view);
            else done(undefined);
          } else if (keys.matches(data, 'app.tools.expand'))
            view.expanded = !view.expanded;
          else if (matchesKey(data, 'pageUp'))
            view.scroll += Math.max(1, bodyRows - 2);
          else if (matchesKey(data, 'pageDown'))
            view.scroll = Math.max(0, view.scroll - bodyRows + 2);
          else if (matchesKey(data, 'ctrl+end')) view.scroll = 0;
          else editor.handleInput(data);
          tui.requestRender();
        },
      };
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
