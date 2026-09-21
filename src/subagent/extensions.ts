import type {
  ExtensionUIContext,
  ToolInfo,
} from '@earendil-works/pi-coding-agent';
import {isAbsolute} from 'node:path';

const builtins = ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'];
const communication = [
  'ask_parent',
  'notify_parent',
  'send_agent_message',
  'poll_agent_messages',
];

export function inheritedTools(parentTools: readonly ToolInfo[]): string[] {
  return parentTools
    .filter(
      tool =>
        tool.sourceInfo.source !== 'builtin' &&
        !builtins.includes(tool.name) &&
        tool.name !== 'subagent' &&
        !communication.includes(tool.name),
    )
    .map(tool => tool.name);
}

export function extensionPaths(
  names: readonly string[],
  parentTools: readonly ToolInfo[],
): string[] {
  const paths = new Set<string>();
  for (const name of names) {
    if (communication.includes(name)) continue;
    if (name === 'subagent') throw new Error('Subagents cannot delegate.');
    const tool = parentTools.find(tool => tool.name === name);
    if (!tool || tool.sourceInfo.source === 'builtin') {
      if (!builtins.includes(name))
        throw new Error(
          `Required extension tool is not active in the parent: ${name}`,
        );
      continue;
    }
    const path = tool.sourceInfo.path;
    if (!isAbsolute(path))
      throw new Error(
        `Required extension tool has no reloadable source: ${name}`,
      );
    paths.add(path);
  }
  return [...paths];
}

// Pi treats a supplied UI adapter as hasUI=true. Its mode remains json, and
// every interactive request fails explicitly instead of using Pi's no-op UI.
export function childUI(
  theme: ExtensionUIContext['theme'],
): ExtensionUIContext {
  const unsupported = (): never => {
    throw new Error(
      'Interactive UI is not supported in subagents. Use ask_parent instead.',
    );
  };
  return {
    select: unsupported,
    confirm: unsupported,
    input: unsupported,
    notify: unsupported,
    onTerminalInput: unsupported,
    setStatus: unsupported,
    setWorkingMessage: unsupported,
    setWorkingVisible: unsupported,
    setWorkingIndicator: unsupported,
    setHiddenThinkingLabel: unsupported,
    setWidget: unsupported,
    setFooter: unsupported,
    setHeader: unsupported,
    setTitle: unsupported,
    custom: unsupported,
    pasteToEditor: unsupported,
    setEditorText: unsupported,
    getEditorText: unsupported,
    editor: unsupported,
    addAutocompleteProvider: unsupported,
    setEditorComponent: unsupported,
    getEditorComponent: unsupported,
    theme,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: unsupported,
    getToolsExpanded: () => false,
    setToolsExpanded: unsupported,
  };
}
