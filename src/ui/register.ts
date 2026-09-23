import {
  getAgentDir,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  SettingsManager,
  type ExtensionAPI,
  type BashToolOptions,
} from '@earendil-works/pi-coding-agent';
import {registerWelcome} from './welcome';
import {registerAssistantDisplay} from './assistant';
import {RetrievalGroups} from './groups';
import {BashDisplay} from './bash';
import {createWriteDisplay} from './write';
import {createEditDisplay} from './edit';
import {displayRetrieval, readParts, RetrievalDetails} from './retrieval';
import {Schema} from 'effect';
import {registerToolDisplay} from './tool-lookup';
import type {UiSettings} from './settings';

export function registerUi(
  pi: ExtensionAPI,
  settings: UiSettings,
): RetrievalGroups | undefined {
  if (settings.enabled === false) return;
  const owner = registerAssistantDisplay(pi);
  if (settings.welcome !== false) registerWelcome(pi);
  const bash = new BashDisplay(pi);
  const groups =
    settings.retrievalGroups === false ? undefined : new RetrievalGroups(pi);
  const readArgs = Schema.Struct({
    path: Schema.optional(Schema.String),
    offset: Schema.optional(Schema.Number),
    limit: Schema.optional(Schema.Number),
  });
  registerToolDisplay(pi, owner, (tool, session) => {
    if (
      tool.name !== 'read' ||
      !session
        .getAllTools()
        .some(
          entry =>
            entry.name === tool.name && entry.sourceInfo.source === 'builtin',
        )
    )
      return tool;
    return displayRetrieval(
      {...tool},
      'Read',
      args => Schema.decodeUnknownSync(readArgs)(args).path ?? '',
      (output, details, args) => {
        const range = Schema.decodeUnknownSync(readArgs)(args);
        return readParts(
          output,
          Schema.decodeUnknownSync(RetrievalDetails)(details ?? {}),
          range.offset,
          range.limit,
        );
      },
      groups,
    );
  });
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
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
    pi.registerTool(bash.create(ctx.cwd, options, settings));
  });
  return groups;
}
