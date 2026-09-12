// Verification adapter: the pinned Arhen extension retains dispatch and execution.
import upstream from '@arhen/pi-core-subagent';
import {
  CustomEditor,
  FooterComponent,
  type AgentSession,
  type ExtensionAPI,
  type ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent';
import {isKeyRelease, type TUI} from '@earendil-works/pi-tui';
import {RuntimeFleet, type AgentView} from './fleet';
import {openViewer} from './viewer';
import {canvas, paint} from '../subagent-ui-prototype/fleet';

export function installRuntimeFleet(
  pi: ExtensionAPI,
  mainSession?: () => AgentSession,
) {
  const fleet = new RuntimeFleet();
  let tui: TUI | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let footerData: ReadonlyFooterDataProvider = {
    getGitBranch: () => null,
    getExtensionStatuses: () => new Map(),
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  };
  // Custom messages retain model delivery/wakeup without a visible user queue.
  const upstreamApi: ExtensionAPI = {
    ...pi,
    sendUserMessage(content, options) {
      pi.sendMessage(
        {customType: 'subagent-notice', content, display: false},
        {triggerTurn: true, deliverAs: options?.deliverAs ?? 'followUp'},
      );
    },
  };
  upstream(upstreamApi, {
    nativeWidget: false,
    allowCompletedResume: true,
    ready: manager => {
      fleet.manager = manager;
    },
    session: (task, session) => fleet.observe(task, session),
  });

  async function open(selected: AgentView) {
    const ctx = fleet.context;
    if (!ctx || fleet.viewing) return;
    const mainDraft = ctx.ui.getEditorText();
    let next: AgentView | undefined = selected;
    try {
      while (next) {
        fleet.viewing = next;
        next = await openViewer(ctx, fleet, next, footerData);
      }
    } finally {
      fleet.viewing = undefined;
      fleet.focused = false;
      ctx.ui.setEditorText(mainDraft);
      tui?.requestRender();
    }
  }

  pi.on('session_start', (_event, ctx) => {
    fleet.context = ctx;
    fleet.changed = () => tui?.requestRender();
    if (mainSession) {
      ctx.ui.setFooter((terminal, theme, data) => {
        tui = terminal;
        footerData = data;
        const footer = new FooterComponent(mainSession(), data);
        const output = terminal.terminal;
        const write = output.write;
        const themedWrite = (data: string) =>
          write.call(output, canvas(data, ctx.ui.theme));
        output.write = themedWrite;
        return {
          invalidate() {
            footer.invalidate();
          },
          dispose() {
            footer.dispose();
            if (output.write === themedWrite) output.write = write;
          },
          render(width: number) {
            return [
              ...footer.render(width),
              '',
              ...fleet.render(width, theme),
              theme.fg('muted', '空输入 ↓ 选择代理'),
            ].map(line => paint(line, width, theme));
          },
        };
      });
    } else {
      // Pi 0.85.1 exposes no footer-composition/getter API. Keep its actual
      // footer untouched in the compiled-host compatibility probe.
      ctx.ui.setWidget(
        'fleet',
        (terminal, theme) => {
          tui = terminal;
          return {
            invalidate() {},
            render: width => [
              ...fleet.render(width, theme),
              theme.fg('muted', '空输入 ↓ 选择代理'),
            ],
          };
        },
        {placement: 'belowEditor'},
      );
    }
    const previous = ctx.ui.getEditorComponent();
    ctx.ui.setEditorComponent((terminal, theme, keys) => {
      const editor =
        previous?.(terminal, theme, keys) ??
        new CustomEditor(terminal, theme, keys);
      const handle = editor.handleInput.bind(editor);
      editor.handleInput = data => {
        if (isKeyRelease(data)) return;
        const action = fleet.select(data, editor.getText() === '');
        if (action) {
          if (action !== true && action !== 'main') void open(action);
          terminal.requestRender();
        } else handle(data);
      };
      return editor;
    });
    if (timer) clearInterval(timer);
    timer = setInterval(() => tui?.requestRender(), 200);
  });
  pi.registerShortcut('ctrl+shift+a', {
    description: '查看子代理会话',
    handler: async () => {
      const view = fleet.views()[fleet.selected > 0 ? fleet.selected - 1 : 0];
      if (view) await open(view);
    },
  });
  pi.on('session_shutdown', () => {
    if (timer) clearInterval(timer);
    fleet.dispose();
  });
  pi.on('agent_start', () => {
    fleet.mainStarted = Date.now();
    fleet.mainEnded = 0;
  });
  pi.on('agent_end', () => {
    fleet.mainEnded = Date.now();
  });
  pi.on('tool_execution_start', () => {
    fleet.mainTools++;
  });
  return fleet;
}

export default function (pi: ExtensionAPI) {
  installRuntimeFleet(pi);
}
