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
import {advance, send, stop, type DemoAgent} from './model';
import {Conversation} from './conversation';
import {Fleet, canvas, paint} from './fleet';
import {openConversation} from './viewer';

export function createFleetExtension(
  agents: DemoAgent[],
  getSession: (agent: DemoAgent) => AgentSession,
): ExtensionFactory {
  return pi => {
    const first = agents[0];
    if (!first) throw new Error('Prototype needs a main agent');
    const main: DemoAgent = first;
    const fleet = new Fleet(agents);
    let tui: TUI | undefined;
    let footer: FooterComponent | undefined;
    let transcript: Conversation | undefined;
    let viewing = 'main';
    let timer: ReturnType<typeof setInterval> | undefined;

    pi.registerMessageRenderer('fleet-demo', (_message, options, theme) => {
      main.expanded = options.expanded;
      return {
        invalidate() {},
        render: width =>
          (transcript?.render(main, width, 2) ?? []).map(line =>
            paint(line, width, theme),
          ),
      };
    });

    async function open(ctx: ExtensionContext, selected: DemoAgent) {
      if (!footer || viewing !== 'main') return;
      let next: DemoAgent | undefined = selected;
      while (next && next.id !== 'main') {
        viewing = next.id;
        footer.setSession(getSession(next));
        next = await openConversation(ctx, fleet, next, footer);
      }
      viewing = 'main';
      footer.setSession(getSession(main));
      fleet.focused = false;
      tui?.requestRender();
    }

    pi.on('session_start', (_event, ctx) => {
      ctx.ui.setFooter((terminal, theme, data) => {
        tui = terminal;
        // Fullscreen layout creates blank rows outside component renderers.
        // Color the isolated terminal's default SGR/erase output as well.
        const output = terminal.terminal;
        const write = output.write;
        let themeName = ctx.ui.theme.name;
        const themedWrite = (data: string) => {
          if (themeName !== ctx.ui.theme.name) {
            themeName = ctx.ui.theme.name;
            terminal.requestRender(true);
          }
          write.call(output, canvas(data, ctx.ui.theme));
        };
        output.write = themedWrite;
        footer = new FooterComponent(getSession(main), data);
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
            const hint = fleet.focused
              ? '↑↓ 选择 · Enter 进入 · x 停止 · Esc 回到输入'
              : '空输入 ↓ 选择代理';
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
            this.focused = editorFocused && !fleet.focused;
            const lines = super.render(width);
            this.focused = editorFocused;
            return lines;
          }
          override handleInput(data: string) {
            if (isKeyRelease(data)) return;
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
        for (const agent of agents) getSession(agent);
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
        output: '当前会话未启用 shell 执行。',
        exitCode: 1,
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
