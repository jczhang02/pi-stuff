import {
  getAgentDir,
  createReadToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  SettingsManager,
  type ExtensionAPI,
  type BashToolOptions,
} from '@earendil-works/pi-coding-agent';
import {registerWelcome} from './welcome';
import {RetrievalGroups} from './groups';
import {createBashDisplay} from './bash';
import {createWriteDisplay} from './write';
import {createEditDisplay} from './edit';
import {displayRetrieval} from './retrieval';
import type {UiSettings} from './settings';

export function registerUi(
  pi: ExtensionAPI,
  settings: UiSettings,
): RetrievalGroups | undefined {
  if (settings.enabled === false) return;
  if (settings.welcome !== false) registerWelcome(pi);
  const groups =
    settings.retrievalGroups === false ? undefined : new RetrievalGroups(pi);
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) return;
    // Only replace a native definition. Other extensions retain their renderers.
    const tools = pi.getAllTools();
    if (
      tools.some(
        tool => tool.name === 'write' && tool.sourceInfo.source === 'builtin',
      )
    )
      pi.registerTool(createWriteDisplay(ctx.cwd, settings));
    if (
      tools.some(
        tool => tool.name === 'edit' && tool.sourceInfo.source === 'builtin',
      )
    )
      pi.registerTool(createEditDisplay(ctx.cwd, settings));
    const hostSettings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    });
    const native = (name: string) =>
      tools.some(
        tool => tool.name === name && tool.sourceInfo.source === 'builtin',
      );
    if (native('read'))
      pi.registerTool(
        displayRetrieval(
          createReadToolDefinition(ctx.cwd, {
            autoResizeImages: hostSettings.getImageAutoResize(),
          }),
          'Read',
          args => args.path ?? '',
          undefined,
          groups,
        ),
      );
    if (native('grep'))
      pi.registerTool(
        displayRetrieval(
          createGrepToolDefinition(ctx.cwd),
          'Grep',
          args => `${args.pattern ?? ''}, ${args.path ?? '.'}`,
          undefined,
          groups,
        ),
      );
    if (native('find'))
      pi.registerTool(
        displayRetrieval(
          createFindToolDefinition(ctx.cwd),
          'Find',
          args => `${args.pattern ?? ''}, ${args.path ?? '.'}`,
          undefined,
          groups,
        ),
      );
    if (native('ls'))
      pi.registerTool(
        displayRetrieval(
          createLsToolDefinition(ctx.cwd),
          'Ls',
          args => args.path ?? '.',
          undefined,
          groups,
        ),
      );
    if (!native('bash')) return;
    const options: BashToolOptions = {};
    const prefix = hostSettings.getShellCommandPrefix();
    const shell = hostSettings.getShellPath();
    if (prefix !== undefined) options.commandPrefix = prefix;
    if (shell !== undefined) options.shellPath = shell;
    pi.registerTool(createBashDisplay(ctx.cwd, options, settings));
  });
  return groups;
}
