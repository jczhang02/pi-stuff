// One confirmed Fleet layout mounted after Pi's native FooterComponent.
// Throwaway, offline UI prototype: no model calls or executed tool commands.
import {
  CustomEditor,
  FooterComponent,
  type AgentSession,
  type ExtensionFactory,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {isKeyRelease, matchesKey, type TUI} from '@earendil-works/pi-tui';
import {advance, createAgents, send, stop, type DemoAgent} from './model';
import {Conversation} from './conversation';
import {Fleet, canvas, paint} from './fleet';
import {openConversation} from './viewer';

export function createFleetExtension(
  getSession: () => AgentSession,
): ExtensionFactory {
  return pi => {
    const agents = createAgents();
    const main = agents[0];
    if (!main) throw new Error('Prototype needs a main agent');
    const fleet = new Fleet(agents);
    let tui: TUI | undefined;
    let footer: FooterComponent | undefined;
    let transcript: Conversation | undefined;
    let viewing = 'main';
    let controls = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    pi.registerMessageRenderer('fleet-demo', (_message, options, theme) => {
      main.expanded = options.expanded;
      return {
        invalidate() {},
        render: width =>
          [
            theme.fg('muted', 'UI PROTOTYPE · 模拟执行 · 不调用模型'),
            ...(transcript?.render(main, width) ?? []),
          ].map(line => paint(line, width, theme)),
      };
    });

    async function open(ctx: ExtensionContext, selected: DemoAgent) {
      if (!footer || viewing !== 'main') return;
      let next: DemoAgent | undefined = selected;
      while (next && next.id !== 'main') {
        viewing = next.id;
        next = await openConversation(ctx, fleet, next, footer);
      }
      viewing = 'main';
      fleet.focused = false;
      tui?.requestRender();
    }

    function prototypeControl(data: string, ctx: ExtensionContext): boolean {
      if (matchesKey(data, 'f2')) {
        controls = !controls;
        return true;
      }
      if (!controls) return false;
      if (data === 't') {
        ctx.ui.setTheme(ctx.ui.theme.name === 'light' ? 'dark' : 'light');
        transcript?.clear();
        tui?.requestRender(true);
      } else if (data === 'r') {
        transcript?.clear();
        const fresh = createAgents();
        agents.forEach((agent, index) => {
          const replacement = fresh[index];
          if (replacement) Object.assign(agent, replacement);
        });
        ctx.ui.setEditorText('');
        fleet.focused = false;
      } else if (matchesKey(data, 'escape')) controls = false;
      return true;
    }

    pi.on('session_start', (_event, ctx) => {
      ctx.ui.setFooter((terminal, theme, data) => {
        tui = terminal;
        // Fullscreen layout creates blank rows outside component renderers.
        // Color the isolated terminal's default SGR/erase output as well.
        const output = terminal.terminal;
        const write = output.write;
        const themedWrite = (data: string) =>
          write.call(output, canvas(data, ctx.ui.theme));
        output.write = themedWrite;
        footer = new FooterComponent(getSession(), data);
        transcript = new Conversation(terminal, ctx.cwd);
        const nativeFooter = footer;
        return {
          invalidate() {
            nativeFooter.invalidate();
          },
          dispose() {
            nativeFooter.dispose();
            if (output.write === themedWrite) {
              output.write = write;
              write.call(output, '\x1b[0m');
            }
          },
          render(width: number) {
            const hint = controls
              ? '原型控制 · t 切换主题 · r 重播 · F2 返回'
              : fleet.focused
                ? '↑↓ 选择 · Enter 进入 · x 停止 · Esc 回到输入'
                : '空输入 ↓ 选择代理 · F2 原型控制';
            return [
              ...nativeFooter.render(width),
              '',
              ...fleet.render(width, theme, viewing),
              theme.fg('muted', hint),
            ].map(line => paint(line, width, theme));
          },
        };
      });
      ctx.ui.setEditorComponent((terminal, theme, keys) => {
        // Input is intercepted only while this editor owns focus. Native dialogs
        // keep their own arrows/Enter/Escape; no private TUI focus inspection.
        return new (class extends CustomEditor {
          override render(width: number): string[] {
            const editorFocused = this.focused;
            this.focused = editorFocused && !fleet.focused && !controls;
            const lines = super.render(width);
            this.focused = editorFocused;
            return lines;
          }
          override handleInput(data: string) {
            if (isKeyRelease(data)) return;
            if (prototypeControl(data, ctx)) {
              terminal.requestRender();
              return;
            }
            const action = fleet.handleInput(data, this.getText() === '');
            if (action) {
              if (action !== true) void open(ctx, action);
              terminal.requestRender();
              return;
            }
            if (matchesKey(data, 'escape') && main.status === '运行中') {
              stop(main);
              transcript?.settleTools(agents);
              terminal.requestRender();
              return;
            }
            super.handleInput(data);
          }
        })(terminal, theme, keys);
      });
      pi.sendMessage(
        {
          customType: 'fleet-demo',
          content: 'Offline fleet UI fixture',
          display: true,
        },
        {triggerTurn: false},
      );
      timer = setInterval(() => {
        advance(agents, viewing);
        transcript?.settleTools(agents);
        tui?.requestRender();
      }, 200);
    });

    pi.on('input', event => {
      send(main, event.text);
      tui?.requestRender();
      return {action: 'handled'};
    });
    pi.on('user_bash', () => ({
      result: {
        output: 'UI prototype: shell execution is disabled.',
        exitCode: 0,
        cancelled: false,
        truncated: false,
      },
    }));
    pi.on('session_before_switch', () => ({cancel: true}));
    pi.on('session_before_fork', () => ({cancel: true}));
    pi.on('session_shutdown', () => {
      if (timer) clearInterval(timer);
      transcript?.clear();
    });
  };
}
