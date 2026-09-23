import {
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type BashToolOptions,
} from '@earendil-works/pi-coding-agent';
import {registerWelcome} from './welcome';
import {registerAssistantDisplay} from './assistant';
import {RetrievalGroups} from './groups';
import {BashDisplay} from './bash';
import {displayWrite} from './write';
import {displayEdit} from './edit';
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
  const localTools = new Map([
    ['read', 'Read'],
    ['grep', 'Grep'],
    ['find', 'Find'],
    ['ls', 'Ls'],
  ]);
  const localArgs = Schema.Struct({
    pattern: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    offset: Schema.optional(Schema.Number),
    limit: Schema.optional(Schema.Number),
  });
  registerToolDisplay(pi, owner, (tool, session) => {
    if (
      !session
        .getAllTools()
        .some(
          entry =>
            entry.name === tool.name && entry.sourceInfo.source === 'builtin',
        )
    )
      return tool;
    if (tool.name === 'write') return displayWrite(tool, settings);
    if (tool.name === 'edit') return displayEdit(tool, settings);
    const label = localTools.get(tool.name);
    if (!label) return tool;
    return displayRetrieval(
      {...tool},
      label,
      args => {
        const target = Schema.decodeUnknownSync(localArgs)(args);
        const path = target.path ?? (tool.name === 'read' ? '' : '.');
        return tool.name === 'grep' || tool.name === 'find'
          ? `${target.pattern ?? ''}, ${path}`
          : path;
      },
      tool.name === 'read'
        ? (output, details, args) => {
            const range = Schema.decodeUnknownSync(localArgs)(args);
            return readParts(
              output,
              Schema.decodeUnknownSync(RetrievalDetails)(details ?? {}),
              range.offset,
              range.limit,
            );
          }
        : undefined,
      groups,
    );
  });
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    // Only replace a native definition. Other extensions retain their renderers.
    const tools = pi.getAllTools();
    const hostSettings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    });
    const native = (name: string) =>
      tools.some(
        tool => tool.name === name && tool.sourceInfo.source === 'builtin',
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
