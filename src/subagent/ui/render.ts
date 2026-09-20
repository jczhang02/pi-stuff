import type {Theme} from '@earendil-works/pi-coding-agent';
import {truncateToWidth, visibleWidth} from '@earendil-works/pi-tui';
import type {AgentRecord, FleetRecord, TaskRecord} from '../records';
import {
  appendWrapped,
  attentionTaskForAgent,
  countAttention,
  computeFleetColumns,
  formatElapsed,
  formatTokens,
  renderFleetRow,
  oneLine,
  sectionTitle,
  stateColor,
  stateOf,
  taskForAgent,
} from './format';
import {
  compactTaskLabel,
  missingPrerequisites,
  overviewModels,
  prerequisiteNames,
  stableTaskOrder,
  retainedAgents,
} from './navigation';
import {computeDependencyGraphGeometry, renderDependencyGraph} from './graph';
import {detailSections, projectSection, sectionLabels} from './sections';
import {END_SCROLL_OFFSET} from './types';
import {
  inspectionViewport,
  revealOffset,
  targetedMinimumRows,
  windowLines,
} from './viewport';
import type {
  ActionKind,
  BrowsePane,
  DetailSection,
  DraftTarget,
  InspectSurface,
  OverviewModel,
} from './types';

export interface RenderState {
  readonly snapshot: FleetRecord;
  readonly theme: Theme;
  readonly now: number;
  readonly surface: InspectSurface;
  readonly selectedAgentId: string | undefined;
  readonly selectedTaskId: string | undefined;
  readonly selectedHistoryTaskId: string | undefined;
  readonly selectedDispatchId: string | undefined;
  readonly overviewRootTaskId: string | undefined;
  readonly selectedFleetIndex: number;
  readonly selectedOverviewIndex: number;
  readonly selectedDetailSection: DetailSection;
  readonly selectedActionIndex: number;
  readonly openSections: ReadonlySet<DetailSection>;
  readonly pane: BrowsePane;
  readonly graphPan: number;
  readonly scrollOffset: number;
  readonly summaryOffset?: number;
  readonly readerLines: readonly string[];
  readonly readerTitle?: string;
  readonly readerOffset: number;
  readonly readerQuery: string;
  readonly readerFollowing: boolean;
  readonly readerLoading: boolean;
  readonly readerUnread?: number;
  readonly detailUnread?: number;
  readonly actions: readonly ActionKind[];
  readonly draftTarget: DraftTarget | undefined;
  readonly notice: string | undefined;
  readonly lateSteerText: string | undefined;
  readonly stopTaskIds: readonly string[];
  readonly stopConfirm: boolean;
  readonly attentionOnly: boolean;
  readonly editorLines: readonly string[] | undefined;
  readonly terminalRows: number;
  readonly inspectShortcut: string;
  readonly inspectShortcutBlocked: boolean;
}

export function renderInspection(state: RenderState, width: number): string[] {
  if (width < 48 || state.terminalRows < 12)
    return [
      'Terminal too small',
      'Use at least 48 columns and 12 rows · q or Esc back',
    ];
  if (state.surface === 'targeted') return renderTargetedViewport(state, width);
  const lines = renderSurface(state, width);
  if (state.surface === 'fleet' || state.surface === 'overview')
    return lines.map(line => truncateToWidth(line, width, ''));
  return limitLines(
    lines,
    state.surface === 'reader' ? 0 : state.scrollOffset,
    width,
    state.terminalRows,
    state.surface,
  );
}

function renderSurface(state: RenderState, width: number): string[] {
  switch (state.surface) {
    case 'fleet':
      return renderFleet(state, width);
    case 'overview':
      return renderOverview(state, width);
    case 'detail':
      return renderDetail(state, width);
    case 'reader':
      return renderReader(state, width);
    case 'actions':
      return renderActions(state, width);
    case 'help':
      return renderHelp(state, width);
    case 'targeted':
      return renderTargeted(state, width);
    case 'late-steer':
      return renderLateSteer(state, width);
    case 'stop':
      return renderStop(state, width);
  }
}

function renderTop(state: RenderState, title: string): string[] {
  const location =
    state.surface === 'fleet'
      ? 'Fleet'
      : `Agents / ${oneLine(title || 'Inspection')}`;
  const editorSurface = state.surface === 'targeted';
  const lines = [
    state.theme.bold(location),
    state.theme.fg(
      'dim',
      editorSurface ? 'Esc back · draft preserved' : 'q back · ? help',
    ),
  ];
  if (state.snapshot.storageError !== null)
    lines.push(
      state.theme.fg(
        'error',
        `Save failed: ${oneLine(state.snapshot.storageError || 'unknown error')}`,
      ),
    );
  if (state.readerQuery !== '' && state.surface !== 'reader')
    lines.push(
      state.theme.fg(
        'dim',
        `Search: ${oneLine(state.readerQuery) || 'empty query'}`,
      ),
    );
  if (state.notice !== undefined)
    lines.push(
      state.theme.fg('warning', oneLine(state.notice || 'operation notice')),
    );
  return lines;
}

function renderFleet(state: RenderState, width: number): string[] {
  const lines = renderTop(state, 'Fleet');
  const agents = retainedAgents(state.snapshot).filter(
    agent =>
      !state.attentionOnly ||
      attentionTaskForAgent(state.snapshot, agent.id) !== undefined,
  );
  const columns = computeFleetColumns(
    state.snapshot,
    width,
    state.now,
    state.attentionOnly,
  );
  const rows: AgentRecord[] = [
    {
      id: 'main',
      name: 'main',
      dispatchId: '',
      parentAgentId: null,
      createdAt: 0,
      depth: 0,
      configuration: agents[0]?.configuration ?? emptyConfiguration(),
      currentTools: [],
      sessionFile: null,
      workspace: null,
      held: false,
      released: false,
    },
    ...agents,
  ];
  if (rows.length === 1)
    lines.push(
      state.theme.fg(
        'muted',
        state.attentionOnly
          ? 'No subagents need attention.'
          : 'No subagents have been assigned.',
      ),
    );
  const available = Math.max(
    1,
    Math.min(6, state.terminalRows - 5 - lines.length - 3),
  );
  const start = Math.max(
    0,
    Math.min(agents.length - available, state.selectedFleetIndex - available),
  );
  const visibleRows = [
    rows[0],
    ...rows.slice(start + 1, start + 1 + available),
  ];
  for (const [index, agent] of visibleRows.entries()) {
    if (agent === undefined) continue;
    const row = renderFleetRow(
      state.snapshot,
      agent,
      (index === 0 ? 0 : start + index) === state.selectedFleetIndex,
      columns,
      state.theme,
      state.now,
      state.attentionOnly
        ? attentionTaskForAgent(state.snapshot, agent.id)
        : taskForAgent(state.snapshot, agent.id),
    );
    lines.push(row);
  }
  const attention = countAttention(state.snapshot);
  const hiddenAttention = agents.filter(
    (agent, index) =>
      (index < start || index >= start + available) &&
      attentionTaskForAgent(state.snapshot, agent.id) !== undefined,
  ).length;
  const hiddenActive = agents.filter((agent, index) => {
    const task = taskForAgent(state.snapshot, agent.id);
    return (
      (index < start || index >= start + available) &&
      task !== undefined &&
      task.phase !== 'ended'
    );
  }).length;
  const attentionSummary = attention > 0 ? `${attention} attention` : '';
  const offscreenSummary = [
    hiddenActive > 0 ? `${hiddenActive} active` : '',
    hiddenAttention > 0 ? `${hiddenAttention} attention` : '',
  ].filter(Boolean);
  const footerSummary = [
    attentionSummary,
    offscreenSummary.length > 0
      ? `offscreen: ${offscreenSummary.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  lines.push(
    state.theme.fg(
      'dim',
      `${agents.length ? `${start + 1}-${Math.min(agents.length, start + available)} of ${agents.length}` : '0'} agents${footerSummary ? ` · ${footerSummary}` : ''}`,
    ),
  );
  lines.push(
    state.theme.fg(
      'dim',
      'j/k select · enter open · o overview · a actions · q back',
    ),
  );
  return lines;
}

function renderOverview(state: RenderState, width: number): string[] {
  const lines = renderTop(state, 'Overview');
  lines.push(
    state.theme.fg(
      state.pane === 'items' ? 'accent' : 'dim',
      `${state.pane === 'items' ? '●' : '○'} Structure · Tab changes region`,
    ),
  );
  const models = overviewModels(state.snapshot, state.overviewRootTaskId);
  if (models.length === 0) {
    lines.push(
      state.theme.fg(
        'muted',
        'No retained dispatches. Dispatch work to see its structure.',
      ),
    );
    lines.push(state.theme.fg('dim', 'Enter or q returns to the main editor.'));
    return lines;
  }
  const selected = selectedOverviewNode(state, models);
  const structure = overviewStructure(state, width, models);
  const summary: string[] = [];
  if (selected?.task !== undefined)
    renderSummary(state, selected.task, width, summary);
  else if (selected?.reference) {
    summary.push(
      state.theme.bold(
        `${state.pane === 'summary' ? '●' : '○'} Saved input reference`,
      ),
    );
    appendWrapped(
      summary,
      `${selected.label} · Enter follows the original assignment`,
      '  ',
      width,
      state.theme,
    );
  } else summary.push(state.theme.fg('muted', 'No assignment selected.'));
  const budget = overviewBudget(state, summary.length);
  lines.push(
    ...windowLines(
      structure,
      state.scrollOffset,
      budget.structure,
      width,
      'Structure',
    ),
  );
  lines.push(
    state.theme.fg(
      'dim',
      state.pane === 'items'
        ? 'j/k select · h/l pan · u/d scroll · Tab summary · Enter detail'
        : 'j/k or u/d scroll summary · Tab structure · Enter detail',
    ),
  );
  lines.push(summary[0] ?? 'Selected assignment');
  lines.push(
    ...windowLines(
      summary.slice(1),
      state.summaryOffset ?? 0,
      budget.summary - 1,
      width,
      'Summary',
    ),
  );
  return lines;
}

function overviewBudget(state: RenderState, summaryLength: number) {
  const available =
    Math.max(6, state.terminalRows - 5) -
    renderTop(state, 'Overview').length -
    2;
  const summary = Math.min(
    Math.max(3, Math.floor(available / 3)),
    Math.max(1, summaryLength),
  );
  return {summary, structure: Math.max(1, available - summary)};
}

function overviewStructure(
  state: RenderState,
  width: number,
  models: readonly OverviewModel[],
  anchor?: (start: number, end: number) => void,
): string[] {
  const lines: string[] = [];
  for (const model of models) {
    lines.push(
      state.theme.fg(
        'accent',
        `${model.title}${model.hasDependencies ? ' · dependency graph' : ' · independent list'}`,
      ),
    );
    if (model.hasDependencies) {
      const node = computeDependencyGraphGeometry(
        model,
        width,
        state.graphPan,
      ).nodes.find(node => node.id === state.selectedTaskId);
      if (node !== undefined)
        anchor?.(lines.length + node.top, lines.length + node.bottom);
      renderGraph(state, model, width, lines);
    } else {
      const index = stableTaskOrder(state.snapshot, model.dispatchId)
        .filter(task => model.taskIds.includes(task.id))
        .findIndex(task => task.id === state.selectedTaskId);
      if (index >= 0) anchor?.(lines.length + index, lines.length + index);
      renderList(state, model, width, lines);
    }
  }
  return lines;
}

function renderList(
  state: RenderState,
  model: OverviewModel,
  width: number,
  lines: string[],
): void {
  const scoped = new Set(model.taskIds);
  const ordered = stableTaskOrder(state.snapshot, model.dispatchId).filter(
    task => scoped.has(task.id),
  );
  for (const task of ordered) {
    const selected = task.id === state.selectedTaskId;
    const marker = selected
      ? state.theme.fg('accent', '●')
      : state.theme.fg('muted', '○');
    const agent = state.snapshot.agents.find(item => item.id === task.agentId);
    const label = `${oneLine(agent?.name ?? 'agent')} · ${oneLine(compactTaskLabel(task))}`;
    const status = stateColor(state.theme, stateOf(task));
    const suffix = status ? `  ${status}` : '';
    const labelWidth = Math.max(1, width - 2 - visibleWidth(suffix));
    lines.push(
      `${marker} ${state.theme.fg('text', truncateToWidth(label, labelWidth, '…'))}${suffix}`,
    );
  }
}

function renderGraph(
  state: RenderState,
  model: OverviewModel,
  width: number,
  lines: string[],
): void {
  lines.push(
    ...renderDependencyGraph(
      {
        snapshot: state.snapshot,
        selectedTaskId: state.selectedTaskId,
        graphPan: state.graphPan,
      },
      model,
      width,
      state.theme,
    ),
  );
}

function selectedOverviewNode(
  state: RenderState,
  models: readonly OverviewModel[],
) {
  return models
    .flatMap(model => model.nodes)
    .find(node => node.id === state.selectedTaskId);
}

function renderSummary(
  state: RenderState,
  task: TaskRecord,
  width: number,
  lines: string[],
): void {
  const displayState = stateOf(task);
  const stateText =
    displayState || oneLine(task.stage || task.phase || 'in progress');
  lines.push(
    state.theme.bold(
      `${state.pane === 'summary' ? '●' : '○'} Selected assignment · ${stateText}`,
    ),
  );
  lines.push(
    `  Usable as input: ${task.outcome === 'fulfilled' && task.durability === 'saved' ? 'yes' : 'no'}`,
  );
  const agent = state.snapshot.agents.find(item => item.id === task.agentId);
  const label = [
    agent?.name ? oneLine(agent.name) : '',
    oneLine(task.description || task.prompt || 'assignment'),
  ]
    .filter(Boolean)
    .join(' · ');
  appendWrapped(lines, label, '  ', width, state.theme);
  const reason = task.reason.trim();
  if (reason.length > 0 && task.phase !== 'ended')
    appendWrapped(lines, `Reason: ${reason}`, '  ', width, state.theme);
  const report = task.report.trim();
  if (report.length > 0)
    appendWrapped(lines, `Result: ${report}`, '  ', width, state.theme);
  else if (task.outcome !== null || task.declaration !== null)
    appendWrapped(
      lines,
      `Result: ${previewOutcome(task)}`,
      '  ',
      width,
      state.theme,
    );
  else appendWrapped(lines, 'Result: pending', '  ', width, state.theme);
  const prerequisites = prerequisiteNames(state.snapshot, task);
  if (prerequisites.length > 0)
    appendWrapped(
      lines,
      `Prerequisites: ${prerequisites.join(', ')}`,
      '  ',
      width,
      state.theme,
    );
  const missing = missingPrerequisites(state.snapshot, task);
  if (missing.length > 0)
    appendWrapped(
      lines,
      `Missing inputs: ${missing.join(', ')}`,
      '  ',
      width,
      state.theme,
    );
  if (task.durability === 'failed')
    appendWrapped(
      lines,
      'Result unavailable: required saved evidence failed.',
      '  ',
      width,
      state.theme,
    );
  if (task.artifactError)
    appendWrapped(
      lines,
      `Artifact issue: ${task.artifactError}`,
      '  ',
      width,
      state.theme,
    );
}

function renderDetail(
  state: RenderState,
  width: number,
  anchor?: (start: number, end: number) => void,
): string[] {
  const task = selectedTask(state);
  if (task === undefined)
    return [
      ...renderTop(state, 'Detail'),
      state.theme.fg('muted', 'Assignment unavailable.'),
      state.theme.fg('dim', 'q back'),
    ];
  const agent = state.snapshot.agents.find(item => item.id === task.agentId);
  const lines = renderTop(state, agent?.name ?? 'Assignment');
  lines.push(
    state.theme.fg(
      'accent',
      truncateToWidth(
        oneLine(task.description || task.prompt || 'assignment'),
        width,
        '…',
      ),
    ),
  );
  const newer = taskForAgent(state.snapshot, task.agentId);
  if (newer !== undefined && newer.id !== task.id)
    lines.push(
      state.theme.fg('warning', newerAssignmentLine(state.theme, newer, width)),
    );
  const displayState = stateOf(task);
  const currentState = displayState
    ? stateColor(state.theme, displayState)
    : state.theme.fg('dim', oneLine(task.stage || task.phase || 'in progress'));
  lines.push(
    state.theme.fg(
      'dim',
      `${currentState} · ${formatElapsed(task, state.now)} · ↓ ${formatTokens(task.usage?.output)} tokens`,
    ),
  );
  if (state.detailUnread)
    lines.push(state.theme.fg('accent', 'New activity · f follows latest'));
  for (const section of detailSections) {
    const open = state.openSections.has(section);
    const selected = section === state.selectedDetailSection;
    if (selected) {
      const header = Math.max(0, lines.length - 2);
      anchor?.(header, header);
    }
    lines.push(
      `${selected ? state.theme.fg('accent', '●') : state.theme.fg('muted', '○')} ${sectionTitle(state.theme, sectionLabels[section], open)}`,
    );
    if (open)
      renderDetailSection(
        state,
        task,
        section,
        width,
        lines,
        selected ? anchor : undefined,
      );
  }
  lines.push(
    state.theme.fg(
      'dim',
      'j/k section · h/l fold · enter read · a actions · f follow latest · / search',
    ),
  );
  return lines;
}

function renderDetailSection(
  state: RenderState,
  task: TaskRecord,
  section: DetailSection,
  width: number,
  lines: string[],
  anchor?: (start: number, end: number) => void,
): void {
  const content: string[] = [];
  for (const text of projectSection(
    state.snapshot,
    task,
    section,
    state.now,
    state.selectedHistoryTaskId,
    'preview',
  ))
    if (section === 'history')
      content.push(
        state.theme.fg(
          'text',
          `  ${truncateToWidth(oneLine(text), Math.max(8, width - 2), '…')}`,
        ),
      );
    else appendWrapped(content, text, '  ', width, state.theme);
  // Full content has its own reader. Keep the content tree traversable even
  // when a report or a tool log contains thousands of lines.
  const historyAssignments =
    section === 'history'
      ? state.snapshot.tasks
          .filter(candidate => candidate.agentId === task.agentId)
          .toSorted((left, right) => left.admittedAt - right.admittedAt)
      : [];
  const selectedHistoryIndex =
    section === 'history'
      ? historyAssignments.findIndex(
          assignment => assignment.id === state.selectedHistoryTaskId,
        )
      : -1;
  const historyStart =
    section === 'history' && selectedHistoryIndex >= 0
      ? Math.max(0, selectedHistoryIndex - 4)
      : 0;
  const preview = content.slice(
    historyStart,
    historyStart + (section === 'prompt' ? 4 : 6),
  );
  const previewStart = lines.length;
  lines.push(...preview);
  if (section === 'history' && anchor !== undefined) {
    if (
      selectedHistoryIndex >= historyStart &&
      selectedHistoryIndex < historyStart + preview.length
    ) {
      const selectedLine = Math.max(
        0,
        previewStart + selectedHistoryIndex - historyStart - 2,
      );
      anchor(selectedLine, selectedLine);
    }
  }
  if (preview.length < content.length)
    lines.push(
      state.theme.fg(
        'dim',
        `  … ${content.length} lines · Enter reads full ${sectionLabels[section].toLowerCase()}`,
      ),
    );
}

function renderReader(state: RenderState, width: number): string[] {
  const task = selectedTask(state);
  const name = state.snapshot.agents.find(
    agent => agent.id === task?.agentId,
  )?.name;
  const lines = renderTop(
    state,
    `Reader · ${oneLine(name ?? 'assignment')} / ${oneLine(state.readerTitle ?? sectionLabels[state.selectedDetailSection])}`,
  );
  lines.push(
    state.theme.fg(
      'accent',
      state.readerFollowing
        ? 'Following latest output'
        : `Reading retained content${state.readerUnread ? ` · ${state.readerUnread} unread updates` : ''}`,
    ),
  );
  if (state.readerQuery)
    lines.push(state.theme.fg('dim', `Search: ${oneLine(state.readerQuery)}`));
  if (state.readerLoading)
    lines.push(state.theme.fg('warning', 'Loading full retained record...'));
  if (state.readerLines.length === 0) {
    lines.push(state.theme.fg('muted', 'Content unavailable or unreadable.'));
  } else {
    const footerRows = 1;
    const available = Math.max(
      1,
      Math.max(6, state.terminalRows - 5) - lines.length - footerRows - 1,
    );
    const maxStart = Math.max(0, state.readerLines.length - available);
    const start = Math.max(
      0,
      state.readerOffset >= END_SCROLL_OFFSET / 2
        ? maxStart - (END_SCROLL_OFFSET - state.readerOffset)
        : Math.min(state.readerOffset, maxStart),
    );
    const visible = state.readerLines.slice(start, start + available);
    for (const line of visible) {
      const text =
        state.readerQuery &&
        line.toLocaleLowerCase().includes(state.readerQuery.toLocaleLowerCase())
          ? state.theme.fg('accent', line)
          : state.theme.fg('text', line);
      lines.push(truncateToWidth(text, width, ''));
    }
    if (start > 0 || start + visible.length < state.readerLines.length)
      lines.push(
        state.theme.fg(
          'dim',
          `Lines ${start + 1}-${Math.min(state.readerLines.length, start + visible.length)} of ${state.readerLines.length}`,
        ),
      );
  }
  lines.push(
    state.theme.fg(
      'dim',
      'u/d scroll · g/G first/last · / search · n/N match · f follow · q back',
    ),
  );
  return lines;
}

function renderActions(
  state: RenderState,
  width: number,
  anchor?: (start: number, end: number) => void,
): string[] {
  const task = selectedTask(state);
  const agent = state.snapshot.agents.find(item => item.id === task?.agentId);
  const lines = renderTop(
    state,
    agent === undefined ? 'Actions' : `Actions · ${oneLine(agent.name)}`,
  );
  if (task === undefined) {
    lines.push(state.theme.fg('accent', 'Main fleet controls'));
    if (state.actions.includes('reply'))
      appendWrapped(
        lines,
        'A child is waiting for a reply. Enter opens the targeted editor.',
        '  ',
        width,
        state.theme,
      );
  } else {
    lines.push(renderTaskLabelWithState(state.theme, task, width, 'accent'));
  }
  if (state.actions.length === 0)
    lines.push(state.theme.fg('muted', 'No actions are currently available.'));
  for (const [index, action] of state.actions.entries()) {
    if (index === state.selectedActionIndex)
      anchor?.(lines.length - 2, lines.length - 2);
    const marker =
      index === state.selectedActionIndex
        ? state.theme.fg('accent', '●')
        : state.theme.fg('muted', '○');
    lines.push(`${marker} ${actionLabel(action, task?.phase === 'ended')}`);
    if (
      index === state.selectedActionIndex &&
      actionUnavailable(state, action) !== undefined
    )
      appendWrapped(
        lines,
        `Unavailable: ${actionUnavailable(state, action)}`,
        '  ',
        width,
        state.theme,
      );
  }
  lines.push(state.theme.fg('dim', 'j/k select · enter choose · q back'));
  return lines;
}

function actionLabel(action: ActionKind, ended: boolean): string {
  switch (action) {
    case 'inspect':
      return 'Open detail';
    case 'attention':
      return 'Toggle attention filter';
    case 'copy':
      return 'Copy report and diff';
    case 'reader':
      return 'Read full retained record';
    case 'children':
      return 'Open owned children';
    case 'message':
      return 'Message assignment';
    case 'steer':
      return 'Steer active assignment';
    case 'reply':
      return ended ? 'Reply to earlier question' : 'Reply to pending question';
    case 'followup':
      return 'Follow up with retained context';
    case 'stop':
      return 'Stop owned branch';
    case 'release':
      return 'Release workspace';
    case 'recover':
      return 'Recover held or unknown queue';
    case 'queue':
      return 'Queue controls';
    case 'queue-continue':
      return 'Continue queued branch';
    case 'queue-cancel':
      return 'Cancel queued branch';
    case 'acknowledge':
      return 'Acknowledge notice';
  }
}

function actionUnavailable(
  state: RenderState,
  action: ActionKind,
): string | undefined {
  const task = selectedTask(state);
  if (task === undefined)
    return action === 'attention' || action === 'reply'
      ? undefined
      : 'The assignment is no longer retained.';
  if (action === 'steer' && task.phase === 'ended')
    return 'The assignment ended. Convert the draft explicitly to Follow-up.';
  if (
    action === 'release' &&
    state.snapshot.agents.find(agent => agent.id === task.agentId)?.released
  )
    return 'Workspace was already released.';
  return undefined;
}

function renderHelp(state: RenderState, _width: number): string[] {
  return [
    ...renderTop(state, 'Help'),
    state.theme.fg(
      state.inspectShortcutBlocked ? 'warning' : 'accent',
      `Main editor inspect binding: ${state.inspectShortcut}${state.inspectShortcutBlocked ? ' unavailable; configure inspectShortcut' : ''}`,
    ),
    state.theme.bold('60% keyboard controls'),
    'j/k select · enter open · h/l fold, expand or pan · u/d half-page scroll',
    'g/G first or last · tab changes pane · a actions · / search · n/N matches',
    'f follows latest output when explicitly enabled · q or Esc back',
    'Arrows and PageUp/PageDown are optional aliases. Letters work only while browsing.',
    'Editors keep native submission, newline, history, completion and Escape draft behavior.',
    state.theme.fg('dim', 'q or Esc returns to the previous surface.'),
  ];
}

interface TargetedRenderParts {
  readonly header: readonly string[];
  readonly target: string;
  readonly summary: string;
  readonly editor: readonly string[];
  readonly footer: string;
}

function targetedRenderParts(
  state: RenderState,
  width: number,
): TargetedRenderParts | undefined {
  const header = renderTop(state, 'Targeted action');
  const target = state.draftTarget;
  if (target === undefined) return undefined;
  return {
    header,
    target: state.theme.fg(
      'accent',
      `${target.operation} · ${oneLine(target.recipient || 'recipient')}`,
    ),
    summary: state.theme.fg(
      'dim',
      `  ${truncateToWidth(oneLine(target.summary), width - 2, '…')}`,
    ),
    editor: state.editorLines ?? [],
    footer: state.theme.fg(
      'dim',
      'Enter submit · configured newline inserts a line · Esc saves draft and returns',
    ),
  };
}

function renderTargeted(state: RenderState, width: number): string[] {
  const parts = targetedRenderParts(state, width);
  if (parts === undefined)
    return [
      ...renderTop(state, 'Targeted action'),
      state.theme.fg('muted', 'No operation selected.'),
      state.theme.fg('dim', 'q back'),
    ];
  return [
    ...parts.header,
    parts.target,
    parts.summary,
    ...parts.editor,
    parts.footer,
  ];
}

function renderTargetedViewport(state: RenderState, width: number): string[] {
  const parts = targetedRenderParts(state, width);
  if (parts === undefined)
    return renderTargeted(state, width).map(line =>
      truncateToWidth(line, width, ''),
    );
  const header = parts.header.map(line => truncateToWidth(line, width, ''));
  const target = truncateToWidth(parts.target, width, '');
  const summary = truncateToWidth(parts.summary, width, '');
  const editor = parts.editor.map(line => truncateToWidth(line, width, ''));
  const footer = truncateToWidth(parts.footer, width, '');
  const full = [...header, target, summary, ...editor, footer];
  if (full.length <= state.terminalRows) return full;

  const location = header[0] ?? '';
  const compact = [location, target, summary, ...editor, footer];
  if (compact.length <= state.terminalRows) return compact;

  const essential = [location, target, ...editor, footer];
  if (essential.length <= state.terminalRows) return essential;

  return [
    'Terminal too small for the native editor',
    `Resize to at least ${targetedMinimumRows(editor.length)} rows · Esc back`,
  ].map(line => truncateToWidth(line, width, ''));
}

function renderLateSteer(state: RenderState, width: number): string[] {
  const lines = renderTop(state, 'Steer changed');
  appendWrapped(
    lines,
    'This assignment ended while the draft was being edited. Choose an explicit conversion.',
    '  ',
    width,
    state.theme,
  );
  lines.push(
    `${state.selectedActionIndex === 0 ? state.theme.fg('accent', '●') : state.theme.fg('muted', '○')} Convert draft to Follow-up`,
  );
  lines.push(
    `${state.selectedActionIndex === 1 ? state.theme.fg('accent', '●') : state.theme.fg('muted', '○')} Keep draft for later`,
  );
  if (state.lateSteerText !== undefined)
    appendWrapped(
      lines,
      `Draft retained: ${state.lateSteerText}`,
      '  ',
      width,
      state.theme,
    );
  lines.push(state.theme.fg('dim', 'j/k select · enter choose · q back'));
  return lines;
}

function renderStop(
  state: RenderState,
  width: number,
  anchor?: (start: number, end: number) => void,
): string[] {
  const lines = renderTop(state, 'Stop branch');
  const tasks = state.snapshot.tasks.filter(task =>
    state.stopTaskIds.includes(task.id),
  );
  appendWrapped(
    lines,
    'The preview remains live. Confirmation stops this task and its owned descendants as admitted at confirmation time.',
    '  ',
    width,
    state.theme,
  );
  for (const task of tasks) {
    const agent = state.snapshot.agents.find(item => item.id === task.agentId);
    const prefix = `${truncateToWidth(oneLine(agent?.name ?? 'agent'), Math.floor(width / 3), '…')} · `;
    lines.push(
      prefix +
        renderTaskLabelWithState(
          state.theme,
          task,
          width - visibleWidth(prefix),
          'text',
        ),
    );
  }
  anchor?.(
    lines.length - 2 + (state.stopConfirm ? 0 : 1),
    lines.length - 2 + (state.stopConfirm ? 0 : 1),
  );
  lines.push(
    `${state.stopConfirm ? state.theme.fg('accent', '●') : state.theme.fg('muted', '○')} Confirm stop`,
  );
  lines.push(
    `${!state.stopConfirm ? state.theme.fg('accent', '●') : state.theme.fg('muted', '○')} Back without stopping`,
  );
  lines.push(
    state.theme.fg('dim', 'j/k choose · enter confirm or back · q cancels'),
  );
  return lines;
}

function selectedTask(state: RenderState): TaskRecord | undefined {
  return state.selectedTaskId === undefined
    ? undefined
    : state.snapshot.tasks.find(task => task.id === state.selectedTaskId);
}

function renderTaskLabelWithState(
  theme: Theme,
  task: TaskRecord,
  width: number,
  labelColor: Parameters<Theme['fg']>[0],
): string {
  const label = oneLine(task.description || task.prompt || 'assignment');
  const displayState = stateOf(task);
  const renderedState = displayState
    ? stateColor(theme, displayState)
    : theme.fg('dim', oneLine(task.stage || task.phase || 'in progress'));
  const suffix = ` · ${renderedState}`;
  const available = Math.max(8, width - visibleWidth(suffix));
  return `${theme.fg(labelColor, truncateToWidth(label, available, '…'))}${suffix}`;
}

function newerAssignmentLine(
  theme: Theme,
  task: TaskRecord,
  width: number,
): string {
  const prefix = 'Newer assignment · ';
  const suffix = ' · History';
  const available = Math.max(
    8,
    width - visibleWidth(prefix) - visibleWidth(suffix),
  );
  return `${prefix}${renderTaskLabelWithState(theme, task, available, 'text')}${suffix}`;
}

function previewOutcome(task: TaskRecord): string {
  const declared = task.declaration ?? 'not declared';
  const final = task.outcome ?? 'not settled';
  if (declared === 'not declared' && final === 'not settled')
    return `pending · durability ${task.durability}`;
  if (declared === final) return final;
  return `declared ${declared} · final ${final}`;
}

function emptyConfiguration() {
  return {
    model: '—',
    thinking: 'medium' as const,
    tools: [],
    ceiling: [],
    cwd: '—',
    workspace: 'snapshot' as const,
    instructions: '',
    role: null,
    copyHistory: false,
    executionTimeoutMs: null,
    extensions: [],
    baseline: null,
    include: [],
  };
}

function limitLines(
  lines: readonly string[],
  offset: number,
  width: number,
  terminalRows: number,
  surface: InspectSurface,
): string[] {
  const {contentRows} = inspectionViewport(terminalRows, surface);
  const footer = lines.at(-1);
  const contentEnd = footer === undefined ? lines.length : lines.length - 1;
  return [
    ...lines.slice(0, 2).map(line => truncateToWidth(line, width, '')),
    ...windowLines(
      lines.slice(2, contentEnd),
      offset,
      contentRows,
      width,
      'Content',
    ),
    ...(footer === undefined ? [] : [truncateToWidth(footer, width, '')]),
  ];
}

/** Called only after selection or viewport changes; manual scrolling stays intact. */
export function inspectionSelectionOffset(
  state: RenderState,
  width: number,
): number {
  let range: readonly [number, number] | undefined;
  let available = inspectionViewport(
    state.terminalRows,
    state.surface,
  ).revealRows;
  if (state.surface === 'detail')
    renderDetail(state, width, (start, end) => {
      range = [start, end];
    });
  else if (state.surface === 'actions')
    renderActions(state, width, (start, end) => {
      range = [start, end];
    });
  else if (state.surface === 'stop')
    renderStop(state, width, (start, end) => {
      range = [start, end];
    });
  else if (state.surface === 'overview') {
    const models = overviewModels(state.snapshot, state.overviewRootTaskId);
    const summary: string[] = [];
    const selected = selectedOverviewNode(state, models);
    if (selected?.task) renderSummary(state, selected.task, width, summary);
    available = Math.max(
      1,
      overviewBudget(state, Math.max(3, summary.length)).structure - 1,
    );
    overviewStructure(state, width, models, (start, end) => {
      range = [start, end];
    });
  }
  return range === undefined
    ? state.scrollOffset
    : revealOffset(range, state.scrollOffset, available);
}
