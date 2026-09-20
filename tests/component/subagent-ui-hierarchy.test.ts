import {expect, test} from 'bun:test';
import type {Theme} from '@earendil-works/pi-coding-agent';
import type {FleetRecord, TaskRecord} from '../../src/subagent/records';
import {
  inspectionSelectionOffset,
  renderInspection,
  type RenderState,
} from '../../src/subagent/ui/render';
import {projectSection} from '../../src/subagent/ui/sections';
import {detailSections} from '../../src/subagent/ui/sections';
import type {DetailSection, DraftTarget} from '../../src/subagent/ui/types';

function taskRecord(): TaskRecord {
  return {
    id: 'task-a',
    agentId: 'agent-a',
    dispatchId: 'dispatch-a',
    parentTaskId: null,
    prompt: 'Inspect the cache expiry behavior.',
    description: 'Inspect cache expiry',
    needs: [],
    admittedAt: 1,
    startedAt: 2,
    endedAt: null,
    phase: 'executing',
    outcome: null,
    declaration: null,
    stopOutcome: null,
    durability: 'pending',
    acceptance: null,
    reason: '',
    stage: 'model',
    liveText: '',
    activeTools: [],
    report: '',
    files: [],
    checks: [],
    configuration: {
      model: 'fixture/model',
      thinking: 'medium',
      tools: ['read'],
      ceiling: ['read'],
      cwd: '.',
      workspace: 'live',
      instructions: '',
      role: null,
      copyHistory: false,
      executionTimeoutMs: null,
      extensions: [],
      baseline: null,
      include: [],
    },
    currentTools: ['read'],
    usage: null,
    turns: 0,
    retries: 0,
    executionMs: 42,
    lastEventAt: 3,
    sessionFile: null,
    historyFile: null,
    workspaceDirectory: null,
    baseline: null,
    commit: null,
    baselineRequest: null,
    diff: '',
    artifactError: null,
    unsavedFiles: [],
    ignoredFiles: [],
    events: [],
    consumedChildren: [],
  };
}

function fleet(task: TaskRecord): FleetRecord {
  return {
    version: 1,
    sessionId: 'session',
    revision: 1,
    storageError: null,
    agents: [
      {
        id: task.agentId,
        name: 'implementer',
        dispatchId: task.dispatchId,
        parentAgentId: null,
        createdAt: task.admittedAt,
        depth: 0,
        configuration: task.configuration,
        currentTools: task.currentTools,
        sessionFile: null,
        workspace: null,
        held: false,
        released: false,
      },
    ],
    tasks: [task],
    dispatches: [{id: task.dispatchId, admitted: task.admittedAt}],
    messages: [],
    notices: [],
  };
}

// SAFETY: These renderer tests exercise only bold and foreground styling, so
// identity functions provide the complete behavior needed by the selected surfaces.
const plainTheme = {
  bold: (text: string): string => text,
  fg: (_color: string, text: string): string => text,
} as Theme;

function renderState(
  task: TaskRecord,
  overrides: Partial<RenderState> = {},
): RenderState {
  return {
    snapshot: fleet(task),
    theme: plainTheme,
    now: 100,
    surface: 'detail',
    selectedAgentId: task.agentId,
    selectedTaskId: task.id,
    selectedHistoryTaskId: task.id,
    selectedDispatchId: task.dispatchId,
    overviewRootTaskId: undefined,
    selectedFleetIndex: 0,
    selectedOverviewIndex: 0,
    selectedDetailSection: 'history',
    selectedActionIndex: 0,
    openSections: new Set(detailSections),
    pane: 'items',
    graphPan: 0,
    scrollOffset: 0,
    summaryOffset: 0,
    readerLines: [],
    readerTitle: 'assignment',
    readerOffset: 0,
    readerQuery: '',
    readerFollowing: false,
    readerLoading: false,
    actions: [],
    draftTarget: undefined,
    notice: undefined,
    lateSteerText: undefined,
    stopTaskIds: [],
    stopConfirm: false,
    attentionOnly: false,
    editorLines: undefined,
    terminalRows: 24,
    inspectShortcut: 'ctrl+q',
    inspectShortcutBlocked: false,
    ...overrides,
  };
}

test('prompt preview leads with the request while full reading keeps fixed inputs', () => {
  const task = taskRecord();
  const snapshot = fleet(task);
  const preview = projectSection(
    snapshot,
    task,
    'prompt',
    1000,
    undefined,
    'preview',
  );
  expect(preview).toEqual([
    'Original request: Inspect the cache expiry behavior.',
  ]);

  const full = projectSection(snapshot, task, 'prompt');
  expect(full).toContain('History copy: disabled');
  expect(full).toContain('Fixed upstream inputs: none');
});

test('progress preview keeps active work and the latest meaningful event ahead of noise', () => {
  const task: TaskRecord = {
    ...taskRecord(),
    stage: 'tool read',
    reason: 'Reading the implementation.',
    liveText: 'Comparing the cache boundary.',
    activeTools: [
      {
        id: 'tool-1',
        name: 'read',
        startedAt: 4,
        progress: 'src/cache.ts',
      },
    ],
    lastEventAt: 8,
    events: [
      {at: 1, kind: 'limits', text: 'Admission limits.'},
      {at: 8, kind: 'tool-result:read', text: 'Read cache implementation.'},
    ],
  };
  const snapshot = fleet(task);
  const preview = projectSection(
    snapshot,
    task,
    'progress',
    1000,
    undefined,
    'preview',
  );
  expect(preview[0]).toContain('Stage: tool read');
  expect(preview[1]).toContain('Active tool: read');
  expect(preview[2]).toContain('Live text: Comparing');
  expect(preview[3]).toContain('Latest activity:');
  expect(preview[3]).toContain('Read cache implementation.');
  expect(preview.join('\n')).not.toContain('Model:');

  const full = projectSection(snapshot, task, 'progress');
  expect(full.join('\n')).toContain('Model: fixture/model');
  expect(full.join('\n')).toContain('Execution clock: 42ms');
  expect(full.join('\n')).toContain('Admission limits.');
});

test('result preview starts with useful report and retains meaningful delivery signals', () => {
  const task: TaskRecord = {
    ...taskRecord(),
    phase: 'ended',
    outcome: 'fulfilled',
    declaration: 'fulfilled',
    durability: 'saved',
    acceptance: null,
    report: 'Cache expiry now uses the current time boundary.',
    files: ['src/cache.ts'],
    checks: ['bun test tests/cache.test.ts'],
    artifactError: 'An undeclared local file remains.',
    unsavedFiles: ['notes.txt'],
    commit: 'abc123',
    diff: 'diff --git a/src/cache.ts b/src/cache.ts',
  };
  const snapshot = fleet(task);
  const preview = projectSection(
    snapshot,
    task,
    'result',
    1000,
    undefined,
    'preview',
  );
  expect(preview[0]).toBe(
    'Report: Cache expiry now uses the current time boundary.',
  );
  expect(preview[1]).toBe('Saved · awaiting main review');
  expect(preview.join('\n')).not.toContain(
    'Declared outcome: fulfilled · final outcome: fulfilled',
  );
  expect(preview.join('\n')).toContain('Checks: bun test tests/cache.test.ts');
  expect(preview.join('\n')).toContain(
    'Artifact issue: An undeclared local file remains.',
  );
  expect(preview.join('\n')).toContain('Unsaved files: notes.txt');

  const full = projectSection(snapshot, task, 'result');
  const fullText = full.join('\n');
  expect(fullText).toContain(
    'Declared outcome: fulfilled · final outcome: fulfilled',
  );
  expect(fullText).toContain('Stop outcome: none');
  expect(fullText).toContain('Main acceptance: unknown · durability: saved');
  expect(fullText).toContain('Commit: abc123');
  expect(fullText).toContain('diff --git a/src/cache.ts b/src/cache.ts');
});

test('detail selection reveal keeps the selected section above the fixed footer', () => {
  const task = taskRecord();
  const labels = {
    configuration: 'Configuration and usage',
    workspace: 'Workspace and recovery',
    history: 'History and evidence',
  } as const;
  const sections: readonly (keyof typeof labels)[] = [
    'configuration',
    'workspace',
    'history',
  ];
  for (const section of sections) {
    const state = renderState(task, {selectedDetailSection: section});
    const offset = inspectionSelectionOffset(state, 80);
    const rendered = renderInspection({...state, scrollOffset: offset}, 80);
    const output = rendered.join('\n');

    expect(output).toContain(`● ▾ ${labels[section]}`);
    expect(rendered.at(-1)).toContain('j/k section');
  }
});

test('targeted rendering preserves the native editor and submit prompt under a long summary', () => {
  const task = taskRecord();
  const target: DraftTarget = {
    operation: 'message',
    taskId: task.id,
    recipient: 'implementer',
    summary: 'Long summary '.repeat(80),
  };
  const editorLines = [
    'EDITOR_TOP_BORDER',
    'EDITOR_LINE_ONE',
    '\u001b_pi:c\u0007EDITOR_CURSOR_LINE',
    'EDITOR_BOTTOM_BORDER',
  ];
  const state = renderState(task, {
    surface: 'targeted',
    openSections: new Set<DetailSection>(),
    draftTarget: target,
    editorLines,
  });
  const rendered = renderInspection(state, 80);
  const output = rendered.join('\n');

  expect(output).toContain('EDITOR_TOP_BORDER');
  expect(output).toContain('EDITOR_CURSOR_LINE');
  expect(output).toContain('\u001b_pi:c\u0007');
  expect(output).toContain('EDITOR_BOTTOM_BORDER');
  expect(output).toContain('Enter submit');
});

test('targeted viewport keeps the native editor cursor at supported heights', () => {
  const task = taskRecord();
  const target: DraftTarget = {
    operation: 'message',
    taskId: task.id,
    recipient: 'implementer',
    summary: 'Compact summary',
  };
  const editorLines = [
    'EDITOR_TOP_BORDER',
    'EDITOR_LINE_ONE',
    'EDITOR_LINE_TWO',
    'EDITOR_LINE_THREE',
    'EDITOR_LINE_FOUR',
    'EDITOR_LINE_FIVE',
    '\u001b_pi:c\u0007EDITOR_CURSOR_LINE',
    'EDITOR_BOTTOM_BORDER',
  ];
  for (const terminalRows of [12, 14, 16, 24]) {
    const state = renderState(task, {
      surface: 'targeted',
      openSections: new Set<DetailSection>(),
      draftTarget: target,
      editorLines,
      terminalRows,
    });
    const output = renderInspection(state, 80).join('\n');
    expect(output).toContain('\u001b_pi:c\u0007EDITOR_CURSOR_LINE');
    expect(output).toContain('Enter submit');
  }
});

test('targeted viewport keeps the native completion list and submit prompt', () => {
  const task = taskRecord();
  const target: DraftTarget = {
    operation: 'message',
    taskId: task.id,
    recipient: 'implementer',
    summary: 'Compact summary',
  };
  const editorLines = [
    'EDITOR_TOP_BORDER',
    'EDITOR_LINE_ONE',
    '\u001b_pi:c\u0007EDITOR_CURSOR_LINE',
    'EDITOR_BOTTOM_BORDER',
    'candidate-5',
    'candidate-6',
    'candidate-7',
    'candidate-8',
    '→ candidate-9',
    '(10/10)',
  ];
  const state = renderState(task, {
    surface: 'targeted',
    openSections: new Set<DetailSection>(),
    draftTarget: target,
    editorLines,
    terminalRows: 24,
  });
  const output = renderInspection(state, 80).join('\n');

  expect(output).toContain('→ candidate-9');
  expect(output).toContain('(10/10)');
  expect(output).toContain('Enter submit');
  expect(output).not.toContain('Content 1-');
});

test('targeted viewport explains when the native editor exceeds the terminal', () => {
  const task = taskRecord();
  const target: DraftTarget = {
    operation: 'message',
    taskId: task.id,
    recipient: 'implementer',
    summary: 'Compact summary',
  };
  const state = renderState(task, {
    surface: 'targeted',
    openSections: new Set<DetailSection>(),
    draftTarget: target,
    editorLines: Array.from(
      {length: 15},
      (_unused, index) => `editor ${index}`,
    ),
    terminalRows: 12,
  });
  const output = renderInspection(state, 80).join('\n');

  expect(output).toContain('Terminal too small for the native editor');
  expect(output).toContain('Resize to at least 18 rows');
  expect(output).not.toContain('Content 1-');
});

test('detail activity is a qualitative notice instead of a token-like count', () => {
  const task = taskRecord();
  const state = renderState(task, {
    openSections: new Set<DetailSection>(),
    detailUnread: 839,
  });
  const output = renderInspection(state, 80).join('\n');

  expect(output).toContain('New activity · f follows latest');
  expect(output).not.toContain('839 new activity');
});

test('narrow overview keeps assignment state visible beside long descriptions', () => {
  const task: TaskRecord = {
    ...taskRecord(),
    phase: 'waiting',
    description:
      'Read the cache implementation and ask about TTL policy. '.repeat(8),
  };
  for (const width of [48, 80, 120]) {
    const lines = renderInspection(
      renderState(task, {surface: 'overview'}),
      width,
    );
    expect(lines.find(line => line.startsWith('● implementer'))).toContain(
      'Waiting',
    );
    expect(lines.find(line => line.includes('Selected assignment'))).toContain(
      'Waiting',
    );
    expect(lines.join('\n')).toContain('Usable as input: no');
    const saved = renderInspection(
      renderState(
        {...task, phase: 'ended', outcome: 'fulfilled', durability: 'saved'},
        {surface: 'overview'},
      ),
      width,
    );
    expect(saved.join('\n')).toContain('Usable as input: yes');
  }
});
