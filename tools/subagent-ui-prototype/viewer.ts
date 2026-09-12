import {
  CustomEditor,
  getSelectListTheme,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {isKeyRelease, matchesKey, type Component} from '@earendil-works/pi-tui';
import {Conversation} from './conversation';
import {Fleet, paint} from './fleet';
import {send, stop, type DemoAgent} from './model';

// Child presentation is a full-screen custom view; execution remains in memory.
export function openConversation(
  ctx: ExtensionContext,
  fleet: Fleet,
  agent: DemoAgent,
  footer: Component,
): Promise<DemoAgent | undefined> {
  return ctx.ui.custom<DemoAgent | undefined>(
    (tui, theme, keys, done) => {
      const transcript = new Conversation(tui, ctx.cwd);
      const editor = new CustomEditor(
        tui,
        {
          borderColor: text => theme.fg('border', text),
          selectList: getSelectListTheme(),
        },
        keys,
      );
      let bodyRows = 10;
      let notice = '';
      editor.setText(agent.draft);
      agent.unread = 0;
      editor.onSubmit = value => {
        if (value.trim().startsWith('/'))
          notice = '原型只模拟文字交流；Pi 命令请返回 main 使用。';
        else {
          send(agent, value);
          editor.setText('');
          notice = '';
        }
        tui.requestRender();
      };
      return {
        focused: true,
        invalidate() {
          editor.invalidate();
        },
        dispose() {
          agent.draft = editor.getText();
          transcript.clear();
        },
        render(width: number): string[] {
          editor.focused = !fleet.focused;
          if (width < 50 || tui.terminal.rows < 18)
            return [
              paint('至少需要 50 列 × 18 行；Ctrl+C 返回 main。', width, theme),
            ];
          const header = [
            theme.bold(`${agent.name}  /  ${agent.task}`),
            theme.fg(
              'muted',
              'UI PROTOTYPE · 模拟执行 · Pi 原生消息与工具组件',
            ),
            '',
          ];
          const hints = fleet.focused
            ? '↑↓ 选择 · Enter 进入 · x 停止 · Esc 回到输入'
            : `Enter 发送 · 空输入 ↓ 选择代理 · Ctrl+C 返回 main · Esc ${agent.status === '运行中' ? '中断' : '返回'}`;
          const bottom = [
            theme.fg(
              'accent',
              `发送给 ${agent.name}${agent.pending ? ' · 补充消息将在当前轮结束后处理' : ''}`,
            ),
            ...editor.render(width),
            ...footer.render(width),
            '',
            ...fleet.render(width, theme, agent.id),
            theme.fg('muted', hints),
            ...(notice ? [theme.fg('warning', notice)] : []),
          ];
          bodyRows = Math.max(
            1,
            tui.terminal.rows - header.length - bottom.length,
          );
          const all = transcript.render(agent, width);
          agent.scroll = Math.min(
            agent.scroll,
            Math.max(0, all.length - bodyRows),
          );
          const end = all.length - agent.scroll;
          const body = all.slice(Math.max(0, end - bodyRows), end);
          while (body.length < bodyRows) body.push('');
          return [...header, ...body, ...bottom].map(line =>
            paint(line, width, theme),
          );
        },
        handleInput(data: string) {
          if (isKeyRelease(data)) return;
          const action = fleet.handleInput(data, editor.getText() === '');
          if (action === true) {
            tui.requestRender();
            return;
          }
          if (action) {
            done(action);
            return;
          }
          if (matchesKey(data, 'ctrl+c')) done(undefined);
          else if (matchesKey(data, 'escape')) {
            if (agent.status === '运行中') {
              stop(agent);
              transcript.settleTools(fleet.agents);
            } else done(undefined);
          } else if (keys.matches(data, 'app.tools.expand'))
            agent.expanded = !agent.expanded;
          else if (matchesKey(data, 'pageUp'))
            agent.scroll += Math.max(1, bodyRows - 2);
          else if (matchesKey(data, 'pageDown'))
            agent.scroll = Math.max(0, agent.scroll - bodyRows + 2);
          else if (matchesKey(data, 'ctrl+end')) agent.scroll = 0;
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
