import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {homedir} from 'node:os';
import {Effect} from 'effect';
import {renderFooter} from './footer';
import {readGit, type GitState} from './git';
import {cacheHit, readCompaction, type Compaction} from './usage';
import type {StatuslineSettings} from './settings';

export function registerStatusline(
  pi: ExtensionAPI,
  settings: StatuslineSettings = {},
) {
  let installed = false;
  let context: ExtensionContext | undefined;
  let compaction: Compaction | undefined;
  let refresh: (() => void) | undefined;
  let dispose: (() => void) | undefined;

  pi.on('session_start', async (_event, ctx) => {
    context = ctx;
    if (ctx.mode !== 'tui') return;
    compaction = await Effect.runPromise(readCompaction(ctx));
    if (installed) {
      refresh?.();
      return;
    }
    installed = true;
    if (settings.enabled === false) {
      ctx.ui.setFooter(undefined);
      return;
    }
    ctx.ui.setFooter((tui, theme, footerData) => {
      let git: GitState = {kind: 'unknown'};
      let disposed = false;
      let pending = false;
      let running = false;
      let controller: AbortController | undefined;
      const update = async () => {
        if (disposed) return;
        pending = true;
        if (running) return;
        running = true;
        try {
          while (pending && !disposed && context) {
            pending = false;
            const current = context;
            controller = new AbortController();
            const result = await Effect.runPromise(
              readGit(current.cwd, controller.signal),
            );
            if (disposed) return;
            if (current !== context) {
              pending = true;
              continue;
            }
            git = result;
            tui.requestRender();
          }
        } finally {
          running = false;
        }
      };
      refresh = () => {
        void update();
      };
      const unsubscribe = footerData.onBranchChange(refresh);
      dispose = () => {
        disposed = true;
        controller?.abort();
        unsubscribe();
        refresh = undefined;
      };
      refresh();
      return {
        render(width) {
          const active = context ?? ctx;
          const home = homedir();
          const directory =
            active.cwd === home
              ? '~'
              : active.cwd.startsWith(`${home}/`)
                ? `~${active.cwd.slice(home.length)}`
                : active.cwd;
          return renderFooter(width, theme, {
            directory,
            model: active.model?.id ?? 'no model',
            thinking: pi.getThinkingLevel(),
            usage: active.getContextUsage(),
            capacity: active.model?.contextWindow,
            compaction,
            hit: cacheHit(active.sessionManager.getBranch()),
            git,
            branch: footerData.getGitBranch(),
            statuses: footerData.getExtensionStatuses(),
          });
        },
        invalidate() {},
        dispose,
      };
    });
  });
  pi.on('model_select', async (_event, ctx) => {
    context = ctx;
    compaction = await Effect.runPromise(readCompaction(ctx));
  });
  const updateContext = (ctx: ExtensionContext) => {
    context = ctx;
    refresh?.();
  };
  pi.on('tool_execution_end', (_event, ctx) => updateContext(ctx));
  pi.on('session_tree', (_event, ctx) => updateContext(ctx));
  pi.on('agent_end', (_event, ctx) => updateContext(ctx));
  pi.on('session_shutdown', () => {
    dispose?.();
  });
}
