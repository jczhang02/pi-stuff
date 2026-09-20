import type {
  ExtensionContext,
  SessionEntry,
  SessionHeader,
} from '@earendil-works/pi-coding-agent';
import {randomUUID} from 'node:crypto';
import {Schema} from 'effect';
import {decodeSessionRecord} from './session-records';

export const PARENT_HISTORY_TYPE = 'parent-history' as const;
export const PARENT_HISTORY_VERSION = 1 as const;
export const FORK_CONTROL_CUSTOM_TYPE = 'pi-stuff:fork-control' as const;

export interface ParentHistorySnapshot {
  readonly type: typeof PARENT_HISTORY_TYPE;
  readonly version: typeof PARENT_HISTORY_VERSION;
  readonly sourceSessionId: string;
  readonly cwd: string;
  readonly entries: readonly SessionEntry[];
}

export interface ForkControlDetails {
  readonly type: 'fork-control';
  readonly kind: 'unresolved-tool-call' | 'invalid-tool-result';
  readonly toolCallId: string;
  readonly toolName: string;
}

interface ToolCallReference {
  readonly entryIndex: number;
  readonly contentIndex: number;
  readonly id: string;
  readonly name: string;
}

const ParentHistoryContract = Schema.Struct({
  type: Schema.Literal(PARENT_HISTORY_TYPE),
  version: Schema.Literal(PARENT_HISTORY_VERSION),
  sourceSessionId: Schema.String,
  cwd: Schema.String,
  entries: Schema.Array(Schema.Unknown),
});

export function decodeParentHistory(serialized: string): ParentHistorySnapshot {
  const snapshot = Schema.decodeUnknownSync(
    Schema.fromJsonString(ParentHistoryContract),
  )(serialized);
  return {
    ...snapshot,
    entries: snapshot.entries.map(entry =>
      decodeSessionRecord(JSON.stringify(entry)),
    ),
  };
}

function isContextEntry(entry: SessionEntry): boolean {
  switch (entry.type) {
    case 'message':
    case 'custom_message':
    case 'compaction':
    case 'branch_summary':
    case 'model_change':
    case 'thinking_level_change':
      return true;
    case 'custom':
    case 'label':
    case 'session_info':
      return false;
  }
}

function controlText(details: ForkControlDetails): string {
  if (details.kind === 'unresolved-tool-call') {
    return `[Fork control] Parent tool call "${details.toolName}" (${details.toolCallId}) was unresolved at the fork and was not executed in the child.`;
  }
  return `[Fork control] Parent tool result for "${details.toolName}" (${details.toolCallId}) was not copied because its call/result pair was invalid at the fork.`;
}

function createForkControlEntry(
  id: string,
  parentId: string | null,
  timestamp: string,
  details: ForkControlDetails,
): SessionEntry {
  return {
    type: 'custom_message',
    id,
    parentId,
    timestamp,
    customType: FORK_CONTROL_CUSTOM_TYPE,
    content: controlText(details),
    details,
    display: true,
  };
}

function sanitizeToolPairs(entries: SessionEntry[]): SessionEntry[] {
  const callsById = new Map<string, ToolCallReference[]>();
  const callsByPosition = new Map<string, ToolCallReference>();
  const resultById = new Map<string, number>();
  const invalidResultIndices = new Set<number>();

  for (const [entryIndex, entry] of entries.entries()) {
    if (entry.type !== 'message' || entry.message.role !== 'assistant')
      continue;
    for (const [contentIndex, content] of entry.message.content.entries()) {
      if (content.type !== 'toolCall') continue;
      const reference: ToolCallReference = {
        entryIndex,
        contentIndex,
        id: content.id,
        name: content.name,
      };
      const existing = callsById.get(content.id) ?? [];
      existing.push(reference);
      callsById.set(content.id, existing);
      callsByPosition.set(`${entryIndex}:${contentIndex}`, reference);
    }
  }

  for (const [entryIndex, entry] of entries.entries()) {
    if (entry.type !== 'message' || entry.message.role !== 'toolResult')
      continue;
    const calls = callsById.get(entry.message.toolCallId);
    const call = calls?.length === 1 ? calls[0] : undefined;
    if (
      call === undefined ||
      call.entryIndex >= entryIndex ||
      resultById.has(entry.message.toolCallId)
    ) {
      invalidResultIndices.add(entryIndex);
      continue;
    }
    resultById.set(entry.message.toolCallId, entryIndex);
  }

  const unresolved = new Set<ToolCallReference>();
  for (const calls of callsById.values()) {
    const call = calls.length === 1 ? calls[0] : undefined;
    if (call === undefined || !resultById.has(call.id)) {
      for (const call of calls) unresolved.add(call);
    }
  }

  const inlineControlIds = new Set<string>();
  const sanitized = entries.map((entry, entryIndex) => {
    if (invalidResultIndices.has(entryIndex)) {
      if (entry.type !== 'message' || entry.message.role !== 'toolResult')
        throw new Error('Invalid fork history tool result index.');
      const details: ForkControlDetails = {
        type: 'fork-control',
        kind: 'invalid-tool-result',
        toolCallId: entry.message.toolCallId,
        toolName: entry.message.toolName,
      };
      inlineControlIds.add(details.toolCallId);
      return createForkControlEntry(
        entry.id,
        entry.parentId,
        entry.timestamp,
        details,
      );
    }
    if (entry.type !== 'message' || entry.message.role !== 'assistant')
      return entry;
    const content = entry.message.content.filter((block, contentIndex) => {
      if (block.type !== 'toolCall') return true;
      const reference = callsByPosition.get(`${entryIndex}:${contentIndex}`);
      return reference === undefined || !unresolved.has(reference);
    });
    if (content.length === entry.message.content.length) return entry;
    return {...entry, message: {...entry.message, content}};
  });

  let next = sanitized;
  for (const reference of unresolved) {
    if (inlineControlIds.has(reference.id)) continue;
    const previous = next.at(-1);
    const details: ForkControlDetails = {
      type: 'fork-control',
      kind: 'unresolved-tool-call',
      toolCallId: reference.id,
      toolName: reference.name,
    };
    next = [
      ...next,
      createForkControlEntry(
        randomUUID(),
        previous?.id ?? null,
        new Date().toISOString(),
        details,
      ),
    ];
  }
  return next;
}

function rebaseEntries(entries: SessionEntry[]): SessionEntry[] {
  const sourceToChildId = new Map<string, string>();
  const childIds = entries.map(() => randomUUID());
  for (const [index, entry] of entries.entries()) {
    const childId = childIds[index];
    if (childId === undefined)
      throw new Error('Fork history entry id allocation failed.');
    if (sourceToChildId.has(entry.id))
      throw new Error(`Fork history contains duplicate entry id ${entry.id}.`);
    sourceToChildId.set(entry.id, childId);
  }

  return entries.map((entry, index) => {
    const id = childIds[index];
    let parentId: string | null = null;
    if (index > 0) {
      const previousId = childIds[index - 1];
      if (previousId === undefined)
        throw new Error('Fork history entry id allocation failed.');
      parentId = previousId;
    }
    if (id === undefined)
      throw new Error('Fork history entry id allocation failed.');
    switch (entry.type) {
      case 'compaction':
        return {
          ...entry,
          id,
          parentId,
          firstKeptEntryId:
            sourceToChildId.get(entry.firstKeptEntryId) ??
            childIds[index + 1] ??
            id,
        };
      case 'branch_summary':
        return {
          ...entry,
          id,
          parentId,
          fromId: sourceToChildId.get(entry.fromId) ?? id,
        };
      default:
        return {...entry, id, parentId};
    }
  });
}

function cloneEntries(entries: readonly SessionEntry[]): SessionEntry[] {
  let cloned: SessionEntry[];
  try {
    cloned = structuredClone([...entries]);
    JSON.stringify(cloned);
  } catch (error) {
    throw new Error('Parent history contains data that cannot be serialized.', {
      cause: error,
    });
  }
  return cloned;
}

export function captureParentHistory(
  parent: Pick<ExtensionContext, 'sessionManager'>,
): ParentHistorySnapshot {
  const visibleEntries = parent.sessionManager
    .buildContextEntries()
    .filter(isContextEntry);
  const sanitized = sanitizeToolPairs(cloneEntries(visibleEntries));
  const entries = rebaseEntries(sanitized);
  const snapshot: ParentHistorySnapshot = {
    type: PARENT_HISTORY_TYPE,
    version: PARENT_HISTORY_VERSION,
    sourceSessionId: parent.sessionManager.getSessionId(),
    cwd: parent.sessionManager.getCwd(),
    entries,
  };
  try {
    JSON.stringify(snapshot);
  } catch (error) {
    throw new Error('Parent history snapshot is not serializable.', {
      cause: error,
    });
  }
  return snapshot;
}

export function prepareHistoryEntries(
  snapshot: ParentHistorySnapshot,
): SessionEntry[] {
  const candidate = decodeParentHistory(JSON.stringify(snapshot));
  const entries = cloneEntries(candidate.entries);
  return rebaseEntries(sanitizeToolPairs(entries));
}

export function createSessionHeader(
  cwd: string,
  parentSession: string | undefined,
): SessionHeader {
  const header: SessionHeader = {
    type: 'session',
    version: 3,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    cwd,
  };
  if (parentSession !== undefined) header.parentSession = parentSession;
  return header;
}
