import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {registerWelcome} from './welcome';
import {registerAssistantDisplay} from './assistant';
import {RetrievalGroups} from './groups';
import {BashDisplay} from './bash';
import {displayWrite} from './write';
import {displayEdit} from './edit';
import {displayRetrieval, readParts, RetrievalDetails} from './retrieval';
import {Schema} from 'effect';
import {stripTerminalSequences} from '@earendil-works/pi-tui';
import {registerToolDisplay} from './tool-lookup';
import {webView} from './web';
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
      if (tool.name === 'bash') return bash.display(tool, settings);
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
    },
    name => webView(name, groups),
  );
  return groups;
}
