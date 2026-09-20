import {expect, test} from 'bun:test';
import type {Coordinator} from '../../src/subagent/coordinator';
import type {KeybindingsManager as CodingKeybindingsManager} from '@earendil-works/pi-coding-agent';
import type {
  Communication,
  FleetRecord,
  TaskRecord,
} from '../../src/subagent/records';
import type {SubagentInput} from '../../src/subagent/protocol';
import {
  TargetedActionController,
  type DraftEditorPort,
  type TargetedActionHost,
} from '../../src/subagent/ui/actions';
import {
  SubagentEditor,
  type SubagentEditorHost,
} from '../../src/subagent/ui/editor';
import {
  KeybindingsManager as TuiKeybindingsManager,
  TUI_KEYBINDINGS,
  type TUI,
} from '@earendil-works/pi-tui';
import type {DraftTarget, InspectSurface} from '../../src/subagent/ui/types';

function taskRecord(id = 'task-a'): TaskRecord {
  return {
    id,
    agentId: 'agent-a',
    dispatchId: 'dispatch-a',
    parentTaskId: null,
    prompt: 'prompt',
    description: 'description',
    needs: [],
    admittedAt: 1,
    startedAt: 1,
    endedAt: null,
    phase: 'executing',
    outcome: null,
    declaration: null,
    stopOutcome: null,
    durability: 'pending',
    acceptance: null,
    reason: '',
    stage: 'working',
    liveText: '',
    activeTools: [],
    report: '',
    files: [],
    checks: [],
    configuration: {
      model: 'fixture',
      thinking: 'off',
      tools: [],
      ceiling: [],
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
    currentTools: [],
    usage: null,
    turns: 0,
    retries: 0,
    executionMs: 0,
    lastEventAt: 1,
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

function fleet(task: TaskRecord, messages: Communication[] = []): FleetRecord {
  return {
    version: 1,
    sessionId: 'session',
    revision: 1,
    storageError: null,
    agents: [],
    tasks: [task],
    dispatches: [{id: task.dispatchId, admitted: task.admittedAt}],
    messages,
    notices: [],
  };
}

class FakeEditor implements DraftEditorPort {
  target: DraftTarget | undefined;
  textValue = '';
  clearCount = 0;
  revision = 0;
  submitted:
    | {
        readonly target: DraftTarget;
        readonly text: string;
        readonly revision: number;
      }
    | undefined;

  beginDraft(target: DraftTarget, prefill: string): void {
    this.target = target;
    this.textValue = prefill;
    this.revision++;
    this.submitted = undefined;
  }

  clearDraft(): void {
    this.target = undefined;
    this.textValue = '';
    this.clearCount++;
    this.submitted = undefined;
  }

  draftTargetValue(): DraftTarget | undefined {
    return this.target;
  }

  draftText(): string {
    return this.textValue;
  }

  draftRevision(): number {
    return this.revision;
  }

  draftSubmission():
    | {
        readonly target: DraftTarget;
        readonly text: string;
        readonly revision: number;
      }
    | undefined {
    return this.submitted;
  }
}

interface Harness {
  readonly action: TargetedActionController;
  readonly editor: FakeEditor;
  readonly deferred: Array<PromiseWithResolvers<void>>;
  readonly calls: SubagentInput[];
  readonly notices: string[];
  readonly notifications: string[];
  readonly navigation: {detail: number; fleet: number; back: number};
  readonly setSurface: (surface: InspectSurface) => void;
}

function harness(
  task: TaskRecord,
  messages: Communication[] = [],
  selectedTaskId: string | undefined = task.id,
): Harness {
  const editor = new FakeEditor();
  const deferred: Array<PromiseWithResolvers<void>> = [];
  const calls: SubagentInput[] = [];
  const notices: string[] = [];
  const notifications: string[] = [];
  const navigation = {detail: 0, fleet: 0, back: 0};
  const record = fleet(task, messages);
  let generation = 0;
  const setSurface = (_next: InspectSurface): void => {
    generation++;
  };
  // SAFETY: The action tests only exercise Coordinator.execute; no other
  // Coordinator member is observed by TargetedActionController.
  const coordinator = Object.assign(Object.create(null), {
    execute(input: SubagentInput): Promise<void> {
      calls.push(input);
      const pending = Promise.withResolvers<void>();
      deferred.push(pending);
      return pending.promise;
    },
  }) as Coordinator;
  const host: TargetedActionHost = {
    snapshot: () => record,
    selectedTask: () =>
      selectedTaskId === undefined
        ? undefined
        : record.tasks.find(item => item.id === selectedTaskId),
    selectedTaskId: () => selectedTaskId,
    editor: () => editor,
    coordinator: () => coordinator,
    pushFrame: () => {},
    setSurface,
    setActionIndex: () => {},
    setNotice: notice => {
      if (notice !== undefined) notices.push(notice);
    },
    notify: message => notifications.push(message),
    readerText: () => '',
    viewGeneration: () => generation,
    back: () => {
      navigation.back++;
      generation++;
    },
    backToDetail: () => {
      navigation.detail++;
      generation++;
    },
    backToFleet: () => {
      navigation.fleet++;
      generation++;
    },
    requestRender: () => {},
  };
  const action = new TargetedActionController(host);
  return {
    action,
    editor,
    deferred,
    calls,
    notices,
    notifications,
    navigation,
    setSurface,
  };
}

interface NativeHarness {
  readonly task: TaskRecord;
  readonly editor: SubagentEditor;
  readonly action: TargetedActionController;
  readonly deferred: PromiseWithResolvers<void>;
  readonly submitted: () => Promise<void> | undefined;
  readonly notifications: string[];
  readonly surface: () => InspectSurface;
}

function nativeHarness(): NativeHarness {
  const task = taskRecord();
  const record = fleet(task);
  const deferred = Promise.withResolvers<void>();
  let generation = 0;
  let surface: InspectSurface = 'detail';
  let submitted: Promise<void> | undefined;
  const notifications: string[] = [];
  // SAFETY: the native editor test only invokes Coordinator.execute.
  const coordinator = Object.assign(Object.create(null), {
    execute(): Promise<void> {
      return deferred.promise;
    },
  }) as Coordinator;
  // SAFETY: the native editor test only invokes the TUI methods used by Editor input handling.
  const tui = {
    terminal: {columns: 80, rows: 24},
    setFocus: (_component: TUI['children'][number]) => {},
    requestRender: (_force?: boolean) => {},
  } as TUI;
  const identity = (text: string): string => text;
  const tuiKeybindings = new TuiKeybindingsManager(TUI_KEYBINDINGS);
  // SAFETY: SubagentEditor only calls the shared matches/getKeys methods; the
  // test does not exercise coding-agent-specific keybinding persistence.
  const keybindings = tuiKeybindings as CodingKeybindingsManager;
  const editor = new SubagentEditor(
    tui,
    {
      borderColor: identity,
      selectList: {
        selectedPrefix: identity,
        selectedText: identity,
        description: identity,
        scrollInfo: identity,
        noMatch: identity,
      },
    },
    keybindings,
  );
  const host: TargetedActionHost = {
    snapshot: () => record,
    selectedTask: () => task,
    selectedTaskId: () => task.id,
    editor: () => editor,
    coordinator: () => coordinator,
    pushFrame: () => {},
    setSurface: nextSurface => {
      surface = nextSurface;
      generation++;
    },
    setActionIndex: () => {},
    setNotice: () => {},
    notify: message => notifications.push(message),
    readerText: () => '',
    viewGeneration: () => generation,
    back: () => {
      generation++;
      surface = 'detail';
    },
    backToDetail: () => {
      generation++;
      surface = 'detail';
    },
    backToFleet: () => {
      generation++;
      surface = 'fleet';
    },
    requestRender: () => {},
  };
  const action = new TargetedActionController(host);
  const inspector: SubagentEditorHost = {
    isInspecting: () => true,
    isInspectShortcut: () => false,
    noteShortcutConflict: () => {},
    enterFromMain: () => {},
    returnToMain: () => {},
    renderInspection: () => [],
    handleInspectionInput: () => {},
    submitDraft: (target, text) => {
      submitted = action.submit(target, text);
    },
    escapeDraft: (target, text) => {
      action.saveDraft(target, text);
    },
  };
  editor.attachInspector(inspector);
  return {
    task,
    editor,
    action,
    deferred,
    submitted: () => submitted,
    notifications,
    surface: () => surface,
  };
}

test('a stale targeted completion cannot clear a newer same-task draft', async () => {
  const task = taskRecord();
  const h = harness(task);
  h.action.startDraft('message', task);
  const firstTarget = h.editor.target;
  if (firstTarget === undefined) throw new Error('missing first draft');
  h.editor.textValue = 'A';
  const first = h.action.submit(firstTarget, 'A');
  await Bun.sleep(0);
  expect(h.calls).toHaveLength(1);

  h.editor.textValue = 'B';
  h.action.saveDraft(firstTarget, 'B');
  h.action.startDraft('message', task);
  const secondTarget = h.editor.target;
  if (secondTarget === undefined) throw new Error('missing saved draft');
  expect(h.editor.draftText()).toBe('B');

  h.deferred[0]?.resolve();
  await first;
  expect(h.editor.draftText()).toBe('B');
  expect(h.editor.draftTargetValue()).toEqual(secondTarget);
  expect(h.navigation.detail).toBe(0);

  h.editor.clearDraft();
  h.action.startDraft('message', task);
  expect(h.editor.draftText()).toBe('B');
});

test('a native submitted snapshot cannot own a later edit of the same draft', async () => {
  const task = taskRecord();
  const h = harness(task);
  h.action.startDraft('message', task);
  const target = h.editor.target;
  if (target === undefined) throw new Error('missing draft');
  h.editor.textValue = 'A';
  h.editor.submitted = {
    target,
    text: 'A',
    revision: h.editor.revision,
  };
  h.editor.textValue = '';
  const first = h.action.submit(target, 'A');
  await Bun.sleep(0);
  expect(h.calls).toHaveLength(1);

  h.editor.revision++;
  h.editor.textValue = 'B';
  h.deferred[0]?.resolve();
  await first;
  expect(h.editor.draftText()).toBe('B');
  expect(h.navigation.detail).toBe(0);

  h.action.saveDraft(target, 'B');
  h.action.startDraft('message', task);
  expect(h.editor.draftText()).toBe('B');
});

test('native submit then Escape keeps the submitted text across delayed failure', async () => {
  const h = nativeHarness();

  h.action.startDraft('message', h.task);
  h.editor.handleInput('A');
  h.editor.handleInput('\r');
  await Bun.sleep(0);
  const submitted = h.submitted();
  if (submitted === undefined) throw new Error('missing submitted operation');
  h.editor.handleInput('\x1b');
  expect(h.editor.draftTargetValue()).toBeUndefined();

  h.deferred.reject(new Error('delayed failure'));
  await submitted;
  h.action.startDraft('message', h.task);
  expect(h.editor.draftText()).toBe('A');
  expect(`${h.surface()}`).toBe('targeted');
  expect(h.notifications).toContain('message failed: delayed failure');
});

test('native duplicate submission restores newer B without granting A ownership', async () => {
  const h = nativeHarness();
  h.action.startDraft('message', h.task);
  h.editor.handleInput('A');
  h.editor.handleInput('\r');
  await Bun.sleep(0);
  const first = h.submitted();
  if (first === undefined) throw new Error('missing first submitted operation');

  h.editor.handleInput('B');
  h.editor.handleInput('\r');
  await Bun.sleep(0);
  expect(h.editor.draftText()).toBe('B');
  expect(
    h.notifications.some(message => message.includes('already in progress')),
  ).toBe(true);

  h.deferred.reject(new Error('A failed after B'));
  await first;
  h.action.startDraft('message', h.task);
  expect(h.editor.draftText()).toBe('B');
});

test('duplicate submit uses one coordinator operation and a newer version wins', async () => {
  const task = taskRecord();
  const h = harness(task);
  h.action.startDraft('message', task);
  const target = h.editor.target;
  if (target === undefined) throw new Error('missing draft');
  h.editor.textValue = 'A';
  const first = h.action.submit(target, 'A');
  const duplicate = h.action.submit(target, 'A');
  await Bun.sleep(0);
  expect(h.calls).toHaveLength(1);
  expect(
    h.notifications.some(message => message.includes('already in progress')),
  ).toBe(true);
  h.deferred[0]?.resolve();
  await Promise.all([first, duplicate]);
  expect(h.navigation.detail).toBe(1);
  expect(h.editor.draftTargetValue()).toBeUndefined();
});

test('a stale targeted failure cannot overwrite a newer same-task draft', async () => {
  const task = taskRecord();
  const h = harness(task);
  h.action.startDraft('message', task);
  const firstTarget = h.editor.target;
  if (firstTarget === undefined) throw new Error('missing first draft');
  const first = h.action.submit(firstTarget, 'A');
  await Bun.sleep(0);

  h.editor.textValue = 'B';
  h.action.saveDraft(firstTarget, 'B');
  h.action.startDraft('message', task);
  const secondTarget = h.editor.target;
  if (secondTarget === undefined) throw new Error('missing saved draft');
  h.deferred[0]?.reject(new Error('late failure'));
  await first;
  expect(h.editor.draftText()).toBe('B');
  expect(h.editor.draftTargetValue()).toEqual(secondTarget);
  expect(h.navigation.detail).toBe(0);
  expect(
    h.notifications.some(message => message.includes('late failure')),
  ).toBe(true);
  h.editor.clearDraft();
  h.action.startDraft('message', task);
  expect(h.editor.draftText()).toBe('B');
});

test('a stale command completion does not navigate a replacement surface', async () => {
  const task = taskRecord();
  const h = harness(task);
  const command = h.action.release(task);
  await Bun.sleep(0);
  expect(h.calls).toHaveLength(1);
  h.setSurface('fleet');
  h.deferred[0]?.resolve();
  await command;
  expect(h.navigation.detail).toBe(0);
  expect(h.notifications).toContain('release accepted.');
});

test('a stale main reply completion does not navigate over a replacement draft', async () => {
  const task = taskRecord();
  const question: Communication = {
    id: 'question',
    kind: 'question',
    fromTaskId: task.id,
    taskId: null,
    questionId: null,
    text: 'Need a decision',
    receivedAt: 1,
    consumedAt: null,
    expiresAt: null,
  };
  const h = harness(task, [question], undefined);
  h.action.startMainReply('question', 'question', question.text);
  const firstTarget = h.editor.target;
  if (firstTarget === undefined) throw new Error('missing reply draft');
  const first = h.action.submit(firstTarget, 'A');
  await Bun.sleep(0);
  h.editor.textValue = 'B';
  h.action.saveDraft(firstTarget, 'B');
  h.action.startMainReply('question', 'question', question.text);
  expect(h.editor.draftText()).toBe('B');
  h.deferred[0]?.resolve();
  await first;
  expect(h.editor.draftText()).toBe('B');
  expect(h.navigation.fleet).toBe(0);
});
