import type {
  ExtensionAPI,
  MarkdownTransformer,
} from '@earendil-works/pi-coding-agent';
import {registerWelcome} from './welcome';
import {registerAssistantDisplay} from './assistant';
import {RetrievalGroups} from './groups';
import {displayBash} from './bash';
import {displayWrite} from './write';
import {displayEdit} from './edit';
import {displayRetrieval, readParts, RetrievalDetails} from './retrieval';
import {Schema} from 'effect';
import {guardToolView} from './result-block';
import {stripTerminalSequences} from '@earendil-works/pi-tui';
import {registerToolDisplay, type ToolView} from './tool-lookup';
import {webView} from './web';
import type {UiSettings} from './settings';

export function registerUi(
  pi: ExtensionAPI,
  settings: UiSettings,
  owner: MarkdownTransformer,
): RetrievalGroups | undefined {
  if (settings.enabled === false) return;
  registerAssistantDisplay(pi, owner);
  if (settings.welcome !== false) registerWelcome(pi);
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
    path: Schema.optional(Schema.NullOr(Schema.String)),
    // Pi removes optional nulls before execution; renderers see the raw call.
    offset: Schema.optional(Schema.NullOr(Schema.Number)),
    limit: Schema.optional(Schema.NullOr(Schema.Number)),
  });
  function builtinView(name: string, tool: ToolView): ToolView | undefined {
    if (name === 'bash')
      return guardToolView(displayBash(tool, settings), 'Bash');
    if (name === 'write')
      return guardToolView(displayWrite(tool, settings), 'Write');
    if (name === 'edit')
      return guardToolView(displayEdit(tool, settings), 'Edit');
    const label = localTools.get(name);
    if (!label) return;
    return displayRetrieval(
      {...tool, name},
      label,
      args => {
        const target = Schema.decodeUnknownSync(localArgs)(args);
        const path = target.path ?? (name === 'read' ? '' : '.');
        return name === 'grep' || name === 'find'
          ? `${target.pattern ?? ''}, ${path}`
          : path;
      },
      name === 'read'
        ? (output, details, args) => {
            const range = Schema.decodeUnknownSync(localArgs)(args);
            return readParts(
              output,
              Schema.decodeUnknownSync(RetrievalDetails)(details ?? {}),
              range.offset ?? undefined,
              range.limit ?? undefined,
            );
          }
        : undefined,
      groups,
      name === 'read',
    );
  }
  registerToolDisplay(
    pi,
    owner,
    (tool, session) => {
      if (
        !session
          .getAllTools()
          .some(
            entry =>
              entry.name === tool.name && entry.sourceInfo.source === 'builtin',
          )
      ) {
        if (!settings.takeoverTools?.includes(tool.name)) return tool;
        const own = session.resourceLoader
          .getExtensions()
          .extensions.find(
            extension => extension.markdownTransformer === owner,
          );
        if (own?.tools.get(tool.name)?.definition.execute === tool.execute)
          return tool;
        // Opted-in foreign tools get generic text disclosure, never native
        // argument/result interpretation or retrieval-group membership.
        return displayRetrieval(
          {...tool},
          stripTerminalSequences(tool.label),
          args => JSON.stringify(args) ?? '',
          output => [
            {kind: output ? 'body' : 'status', text: output || '(no output)'},
          ],
        );
      }
      return builtinView(tool.name, tool) ?? tool;
    },
    (name, native) =>
      (native ? builtinView(name, native) : undefined) ?? webView(name, groups),
  );
  return groups;
}
