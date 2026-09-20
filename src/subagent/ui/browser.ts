import type {FleetRecord} from '../records';
import {END_SCROLL_OFFSET} from './types';
import type {BrowsePane, DetailSection, InspectSurface} from './types';
import {computeDependencyGraphGeometry} from './graph';
import {dispatchOrder, overviewModels, retainedAgents} from './navigation';
import {attentionTaskForAgent, taskForAgent} from './format';
import {detailSections} from './sections';

interface Frame {
  readonly surface: InspectSurface;
  readonly selectedAgentId: string;
  readonly selectedTaskId: string | undefined;
  readonly selectedHistoryTaskId: string | undefined;
  readonly selectedDispatchId: string | undefined;
  readonly overviewRootTaskId: string | undefined;
  readonly selectedFleetIndex: number;
  readonly selectedOverviewIndex: number;
  readonly selectedDetailSection: DetailSection;
  readonly selectedActionIndex: number;
  readonly pane: BrowsePane;
  readonly graphPan: number;
  readonly scrollOffset: number;
  readonly readerOffset: number;
  readonly summaryOffset: number;
}

export interface FleetRowSelection {
  readonly id: string;
}

export interface SurfaceMatchResult {
  readonly matched: boolean;
  readonly selectionChanged: boolean;
}

/** Owns inspection surfaces, selection frames, and per-surface scroll state. */
export class BrowseNavigator {
  surface: InspectSurface | undefined;
  selectedAgentId = 'main';
  selectedTaskId: string | undefined;
  selectedHistoryTaskId: string | undefined;
  selectedDispatchId: string | undefined;
  overviewRootTaskId: string | undefined;
  selectedFleetIndex = 0;
  selectedOverviewIndex = 0;
  selectedDetailSection: DetailSection = 'prompt';
  selectedActionIndex = 0;
  pane: BrowsePane = 'items';
  graphPan = 0;
  scrollOffset = 0;
  readerOffset = 0;
  summaryOffset = 0;
  attentionOnly = false;
  private attentionBackup:
    | {
        readonly agentId: string;
        readonly taskId: string | undefined;
      }
    | undefined;
  private readonly stack: Frame[] = [];
  private readonly openSectionsByTask = new Map<string, Set<DetailSection>>();

  open(surface: 'fleet' | 'overview', snapshot: FleetRecord): void {
    this.stack.length = 0;
    this.surface = surface;
    this.overviewRootTaskId = undefined;
    this.scrollOffset = 0;
    this.summaryOffset = 0;
    this.pane = 'items';
    if (surface === 'overview') this.prepareOverview(snapshot);
    else this.prepareFleet(snapshot);
  }

  close(): void {
    this.stack.length = 0;
    this.surface = undefined;
  }

  pushFrame(): void {
    if (this.surface === undefined) return;
    this.stack.push({
      surface: this.surface,
      selectedAgentId: this.selectedAgentId,
      selectedTaskId: this.selectedTaskId,
      selectedHistoryTaskId: this.selectedHistoryTaskId,
      selectedDispatchId: this.selectedDispatchId,
      overviewRootTaskId: this.overviewRootTaskId,
      selectedFleetIndex: this.selectedFleetIndex,
      selectedOverviewIndex: this.selectedOverviewIndex,
      selectedDetailSection: this.selectedDetailSection,
      selectedActionIndex: this.selectedActionIndex,
      pane: this.pane,
      graphPan: this.graphPan,
      scrollOffset: this.scrollOffset,
      readerOffset: this.readerOffset,
      summaryOffset: this.summaryOffset,
    });
  }

  popFrame(): boolean {
    const frame = this.stack.pop();
    if (frame === undefined) return false;
    this.surface = frame.surface;
    this.selectedAgentId = frame.selectedAgentId;
    this.selectedTaskId = frame.selectedTaskId;
    this.selectedHistoryTaskId = frame.selectedHistoryTaskId;
    this.selectedDispatchId = frame.selectedDispatchId;
    this.overviewRootTaskId = frame.overviewRootTaskId;
    this.selectedFleetIndex = frame.selectedFleetIndex;
    this.selectedOverviewIndex = frame.selectedOverviewIndex;
    this.selectedDetailSection = frame.selectedDetailSection;
    this.selectedActionIndex = frame.selectedActionIndex;
    this.pane = frame.pane;
    this.graphPan = frame.graphPan;
    this.scrollOffset = frame.scrollOffset;
    this.readerOffset = frame.readerOffset;
    this.summaryOffset = frame.summaryOffset;
    return true;
  }

  hasFrames(): boolean {
    return this.stack.length > 0;
  }

  reconcile(snapshot: FleetRecord): void {
    const agents = this.fleetRows(snapshot);
    const index = agents.findIndex(row => row.id === this.selectedAgentId);
    this.selectedFleetIndex = Math.max(
      0,
      Math.min(agents.length - 1, index < 0 ? 0 : index),
    );
    const row = agents[this.selectedFleetIndex];
    if (row !== undefined) this.selectedAgentId = row.id;
    if (this.surface === undefined || this.surface === 'fleet') {
      this.selectedTaskId = this.currentTaskForAgent(snapshot);
      if (this.surface === undefined)
        this.scrollOffset = Math.max(0, this.selectedFleetIndex - 4);
    }
    if (
      this.selectedTaskId !== undefined &&
      !snapshot.tasks.some(task => task.id === this.selectedTaskId) &&
      !(
        this.surface === 'overview' &&
        this.selectedTaskId.startsWith('reference:')
      )
    )
      this.selectedTaskId = this.currentTaskForAgent(snapshot);
    if (
      this.selectedHistoryTaskId !== undefined &&
      !snapshot.tasks.some(task => task.id === this.selectedHistoryTaskId)
    )
      this.selectedHistoryTaskId = this.selectedTaskId;
    if (
      this.selectedDispatchId !== undefined &&
      !dispatchOrder(snapshot).includes(this.selectedDispatchId)
    )
      this.selectedDispatchId = dispatchOrder(snapshot)[0];

    if (this.surface === 'overview') {
      const ids = this.overviewTaskIds(snapshot);
      const selectedIndex = ids.indexOf(this.selectedTaskId ?? '');
      if (selectedIndex >= 0) this.selectedOverviewIndex = selectedIndex;
      else {
        this.selectedOverviewIndex = Math.max(
          0,
          Math.min(ids.length - 1, this.selectedOverviewIndex),
        );
        this.selectedTaskId = ids[this.selectedOverviewIndex];
      }
    }
  }

  toggleAttention(snapshot: FleetRecord): boolean {
    if (!this.attentionOnly) {
      this.attentionBackup = {
        agentId: this.selectedAgentId,
        taskId: this.selectedTaskId,
      };
      this.attentionOnly = true;
      this.reconcile(snapshot);
      return true;
    }
    this.attentionOnly = false;
    this.reconcile(snapshot);
    return false;
  }

  restoreAttentionSelection(snapshot: FleetRecord): void {
    const backup = this.attentionBackup;
    this.attentionBackup = undefined;
    if (backup !== undefined) {
      const index = this.fleetRows(snapshot).findIndex(
        row => row.id === backup.agentId,
      );
      if (index >= 0) {
        this.selectedFleetIndex = index;
        this.selectedAgentId = backup.agentId;
        this.selectedTaskId = backup.taskId;
      }
    }
    this.reconcile(snapshot);
    if (
      backup?.taskId !== undefined &&
      snapshot.tasks.some(task => task.id === backup.taskId)
    )
      this.selectedTaskId = backup.taskId;
  }

  prepareFleet(snapshot: FleetRecord): void {
    const index = this.fleetRows(snapshot).findIndex(
      row => row.id === this.selectedAgentId,
    );
    this.selectFleetIndex(
      index < 0 ? (this.fleetRows(snapshot).length > 1 ? 1 : 0) : index,
      snapshot,
    );
  }

  prepareOverview(snapshot: FleetRecord): void {
    const models = overviewModels(snapshot, this.overviewRootTaskId);
    const dispatches = models.map(model => model.dispatchId);
    if (
      this.selectedDispatchId === undefined ||
      !dispatches.includes(this.selectedDispatchId)
    )
      this.selectedDispatchId = dispatches[0];
    const ids = this.overviewTaskIds(snapshot);
    const existingIndex = ids.findIndex(id => id === this.selectedTaskId);
    this.selectedOverviewIndex = existingIndex >= 0 ? existingIndex : 0;
    this.selectedTaskId = ids[this.selectedOverviewIndex];
    const selectedNode = models.find(
      item => item.dispatchId === this.selectedDispatchId,
    )?.nodes[this.selectedOverviewIndex];
    this.selectedHistoryTaskId = selectedNode?.task?.id;
    this.graphPan = 0;
    this.summaryOffset = 0;
  }

  prepareOverviewScope(
    snapshot: FleetRecord,
    rootTaskId: string | undefined,
    dispatchId?: string,
    taskId?: string,
  ): void {
    this.overviewRootTaskId = rootTaskId;
    if (dispatchId !== undefined) this.selectedDispatchId = dispatchId;
    if (taskId !== undefined) this.selectedTaskId = taskId;
    this.prepareOverview(snapshot);
  }

  togglePane(): void {
    this.pane = this.pane === 'items' ? 'summary' : 'items';
  }

  pageScroll(
    target: 'main' | 'summary' | 'reader',
    direction: -1 | 1,
    amount: number,
  ): void {
    const current = this.scrollValue(target);
    const next = Math.max(
      0,
      Math.min(END_SCROLL_OFFSET, current + direction * Math.max(1, amount)),
    );
    this.writeScrollValue(target, next);
  }

  jumpScroll(
    target: 'main' | 'summary' | 'reader',
    position: 'start' | 'end',
  ): void {
    this.writeScrollValue(target, position === 'end' ? END_SCROLL_OFFSET : 0);
  }

  seekReader(offset: number): void {
    this.readerOffset = Math.max(0, Math.min(END_SCROLL_OFFSET, offset));
  }

  selectDetail(taskId: string, snapshot: FleetRecord): void {
    this.selectedTaskId = taskId;
    this.selectedHistoryTaskId = taskId;
    this.selectedAgentId =
      snapshot.tasks.find(task => task.id === taskId)?.agentId ??
      this.selectedAgentId;
    this.selectedDetailSection = 'prompt';
    this.selectedActionIndex = 0;
    this.scrollOffset = 0;
    this.initializeSections(snapshot, taskId);
  }

  private moveDetailSection(direction: -1 | 1): void {
    const index = detailSections.indexOf(this.selectedDetailSection);
    this.selectedDetailSection =
      detailSections[
        Math.max(0, Math.min(detailSections.length - 1, index + direction))
      ] ?? 'prompt';
  }

  moveDetail(snapshot: FleetRecord, direction: -1 | 1) {
    if (
      this.selectedDetailSection === 'history' &&
      this.openSections(snapshot).has('history')
    ) {
      const previous = this.selectedHistoryTaskId;
      this.moveHistory(direction, snapshot);
      return {
        sectionChanged: false,
        selectionChanged: previous !== this.selectedHistoryTaskId,
      };
    }
    const previous = this.selectedDetailSection;
    this.moveDetailSection(direction);
    return {
      sectionChanged: previous !== this.selectedDetailSection,
      selectionChanged: false,
    };
  }

  jumpDetail(snapshot: FleetRecord, position: 'first' | 'last') {
    if (
      this.selectedDetailSection === 'history' &&
      this.openSections(snapshot).has('history')
    ) {
      const previous = this.selectedHistoryTaskId;
      this.prepareHistory(snapshot);
      const ids = this.historyTaskIds(snapshot);
      this.selectedHistoryTaskId = position === 'last' ? ids.at(-1) : ids[0];
      return {
        sectionChanged: false,
        selectionChanged: previous !== this.selectedHistoryTaskId,
      };
    }
    const previous = this.selectedDetailSection;
    this.selectedDetailSection =
      position === 'last' ? (detailSections.at(-1) ?? 'prompt') : 'prompt';
    return {
      sectionChanged: previous !== this.selectedDetailSection,
      selectionChanged: false,
    };
  }

  foldDetail(snapshot: FleetRecord, open: boolean): void {
    this.setDetailSectionOpen(snapshot, this.selectedDetailSection, open);
  }

  private setDetailSectionOpen(
    snapshot: FleetRecord,
    section: DetailSection,
    open: boolean,
  ): void {
    const taskId = this.selectedTaskId;
    if (taskId === undefined) return;
    this.initializeSections(snapshot, taskId);
    const sections = this.openSectionsByTask.get(taskId);
    if (sections === undefined) return;
    if (open) sections.add(section);
    else sections.delete(section);
  }

  openSections(snapshot: FleetRecord): ReadonlySet<DetailSection> {
    const taskId = this.selectedTaskId;
    if (taskId === undefined) return new Set<DetailSection>();
    this.initializeSections(snapshot, taskId);
    return this.openSectionsByTask.get(taskId) ?? new Set<DetailSection>();
  }

  revealMain(offset: number): void {
    this.scrollOffset = Math.max(0, Math.min(END_SCROLL_OFFSET, offset));
  }

  selectAction(index: number, count?: number): void {
    const maximum =
      count === undefined ? END_SCROLL_OFFSET : Math.max(0, count - 1);
    this.selectedActionIndex = Math.max(0, Math.min(maximum, index));
  }

  moveAction(direction: -1 | 1, count: number): boolean {
    const previous = this.selectedActionIndex;
    this.selectAction(previous + direction, count);
    return previous !== this.selectedActionIndex;
  }

  jumpAction(position: 'first' | 'last', count: number): boolean {
    const previous = this.selectedActionIndex;
    this.selectAction(position === 'last' ? count - 1 : 0, count);
    return previous !== this.selectedActionIndex;
  }

  retainAction(
    actions: readonly string[],
    selected: string | undefined,
  ): boolean {
    const previous = this.selectedActionIndex;
    const retained = selected === undefined ? -1 : actions.indexOf(selected);
    this.selectAction(
      retained >= 0 ? retained : Math.max(0, actions.indexOf('reader')),
      actions.length,
    );
    return (
      selected !== actions[this.selectedActionIndex] ||
      previous !== this.selectedActionIndex
    );
  }

  fleetRows(snapshot: FleetRecord): readonly FleetRowSelection[] {
    const agents = retainedAgents(snapshot).filter(agent => {
      if (!this.attentionOnly) return true;
      return attentionTaskForAgent(snapshot, agent.id) !== undefined;
    });
    return [{id: 'main'}, ...agents.map(agent => ({id: agent.id}))];
  }

  currentTaskForAgent(snapshot: FleetRecord): string | undefined {
    if (this.selectedAgentId === 'main') return undefined;
    return this.attentionOnly
      ? attentionTaskForAgent(snapshot, this.selectedAgentId)?.id
      : taskForAgent(snapshot, this.selectedAgentId)?.id;
  }

  overviewTaskIds(snapshot: FleetRecord): readonly string[] {
    const models = overviewModels(snapshot, this.overviewRootTaskId);
    const model =
      models.find(item => item.dispatchId === this.selectedDispatchId) ??
      models[0];
    return model?.nodes.map(node => node.id) ?? [];
  }

  moveFleet(direction: -1 | 1, snapshot: FleetRecord): void {
    const rows = this.fleetRows(snapshot);
    this.selectedFleetIndex = Math.max(
      0,
      Math.min(rows.length - 1, this.selectedFleetIndex + direction),
    );
    const row = rows[this.selectedFleetIndex];
    if (row !== undefined) {
      this.selectedAgentId = row.id;
      this.selectedTaskId = this.currentTaskForAgent(snapshot);
      this.scrollOffset = Math.max(0, this.selectedFleetIndex - 4);
    }
  }

  selectFleetIndex(index: number, snapshot: FleetRecord): void {
    const rows = this.fleetRows(snapshot);
    this.selectedFleetIndex = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[this.selectedFleetIndex];
    if (row !== undefined) {
      this.selectedAgentId = row.id;
      this.selectedTaskId = this.currentTaskForAgent(snapshot);
      this.scrollOffset = Math.max(0, this.selectedFleetIndex - 4);
    }
  }

  moveOverview(direction: -1 | 1, snapshot: FleetRecord): void {
    const ids = this.overviewTaskIds(snapshot);
    if (ids.length === 0) return;
    this.selectedOverviewIndex = Math.max(
      0,
      Math.min(ids.length - 1, this.selectedOverviewIndex + direction),
    );
    this.selectedTaskId = ids[this.selectedOverviewIndex];
  }

  selectOverviewIndex(index: number, snapshot: FleetRecord): void {
    const ids = this.overviewTaskIds(snapshot);
    if (ids.length === 0) {
      this.selectedOverviewIndex = 0;
      this.selectedTaskId = undefined;
      return;
    }
    this.selectedOverviewIndex = Math.max(0, Math.min(ids.length - 1, index));
    this.selectedTaskId = ids[this.selectedOverviewIndex];
  }

  moveOverviewDispatch(direction: -1 | 1, snapshot: FleetRecord): void {
    const dispatches = overviewModels(snapshot, this.overviewRootTaskId).map(
      model => model.dispatchId,
    );
    if (dispatches.length === 0) return;
    const current = Math.max(
      0,
      dispatches.indexOf(this.selectedDispatchId ?? ''),
    );
    const next = Math.max(
      0,
      Math.min(dispatches.length - 1, current + direction),
    );
    this.selectedDispatchId = dispatches[next];
    this.selectedOverviewIndex = 0;
    this.selectedTaskId = this.overviewTaskIds(snapshot)[0];
    this.graphPan = 0;
    this.scrollOffset = 0;
    this.summaryOffset = 0;
  }

  /** Keep the selected node inside the horizontal graph viewport. */
  ensureOverviewSelectionVisible(snapshot: FleetRecord, width: number): void {
    const model = overviewModels(snapshot, this.overviewRootTaskId).find(
      candidate => candidate.dispatchId === this.selectedDispatchId,
    );
    if (model === undefined || this.selectedTaskId === undefined) return;
    const selected = computeDependencyGraphGeometry(
      model,
      width,
      this.graphPan,
    ).nodes.find(node => node.id === this.selectedTaskId);
    if (selected === undefined) return;
    const left = 2;
    const right = Math.max(left, width - 2);
    if (selected.x < left) this.graphPan += selected.x - left;
    else if (selected.right > right) this.graphPan += selected.right - right;
  }

  panOverview(direction: -1 | 1, snapshot: FleetRecord, width: number): void {
    const model = overviewModels(snapshot, this.overviewRootTaskId).find(
      candidate => candidate.dispatchId === this.selectedDispatchId,
    );
    if (model === undefined || !model.hasDependencies) return;
    const geometry = computeDependencyGraphGeometry(model, width);
    const minimum = Math.min(0, geometry.minX - 2);
    const maximum = Math.max(0, geometry.maxX - width + 2);
    this.graphPan = Math.max(
      minimum,
      Math.min(maximum, this.graphPan + direction * 4),
    );
  }

  historyTaskIds(snapshot: FleetRecord): readonly string[] {
    if (this.selectedTaskId === undefined) return [];
    const task = snapshot.tasks.find(item => item.id === this.selectedTaskId);
    if (task === undefined) return [];
    return snapshot.tasks
      .filter(candidate => candidate.agentId === task.agentId)
      .toSorted((left, right) => left.admittedAt - right.admittedAt)
      .map(candidate => candidate.id);
  }

  prepareHistory(snapshot: FleetRecord): void {
    const ids = this.historyTaskIds(snapshot);
    if (ids.length === 0) {
      this.selectedHistoryTaskId = undefined;
      return;
    }
    if (!ids.includes(this.selectedHistoryTaskId ?? ''))
      this.selectedHistoryTaskId = this.selectedTaskId;
  }

  private moveHistory(direction: -1 | 1, snapshot: FleetRecord): void {
    const ids = this.historyTaskIds(snapshot);
    if (ids.length === 0) return;
    const current = Math.max(0, ids.indexOf(this.selectedHistoryTaskId ?? ''));
    this.selectedHistoryTaskId =
      ids[Math.max(0, Math.min(ids.length - 1, current + direction))];
  }

  findSurfaceMatch(
    snapshot: FleetRecord,
    query: string,
    direction: -1 | 1,
  ): SurfaceMatchResult {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return {matched: false, selectionChanged: false};

    if (this.surface === 'fleet') {
      const rows = this.fleetRows(snapshot);
      const matching = rows.filter(row => {
        if (row.id === 'main') return 'main'.includes(normalized);
        const agent = snapshot.agents.find(
          candidate => candidate.id === row.id,
        );
        const task = this.attentionOnly
          ? attentionTaskForAgent(snapshot, row.id)
          : taskForAgent(snapshot, row.id);
        return `${agent?.name ?? ''} ${task?.description ?? ''} ${task?.prompt ?? ''}`
          .toLocaleLowerCase()
          .includes(normalized);
      });
      if (matching.length === 0)
        return {matched: false, selectionChanged: false};
      const current = matching.findIndex(
        row => row.id === this.selectedAgentId,
      );
      const next =
        current < 0
          ? 0
          : (current + direction + matching.length) % matching.length;
      const row = matching[next];
      if (row === undefined) return {matched: true, selectionChanged: false};
      const previousAgentId = this.selectedAgentId;
      const previousTaskId = this.selectedTaskId;
      this.selectFleetIndex(rows.indexOf(row), snapshot);
      return {
        matched: true,
        selectionChanged:
          previousAgentId !== this.selectedAgentId ||
          previousTaskId !== this.selectedTaskId,
      };
    }

    if (this.surface === 'overview') {
      const models = overviewModels(snapshot, this.overviewRootTaskId);
      const model = models.find(
        candidate => candidate.dispatchId === this.selectedDispatchId,
      );
      if (model === undefined) return {matched: false, selectionChanged: false};
      const matching = model.nodes.filter(node => {
        const task = node.task;
        const agent = task
          ? snapshot.agents.find(candidate => candidate.id === task.agentId)
          : undefined;
        return `${node.label} ${agent?.name ?? ''} ${task?.prompt ?? ''}`
          .toLocaleLowerCase()
          .includes(normalized);
      });
      if (matching.length === 0)
        return {matched: false, selectionChanged: false};
      const current = matching.findIndex(
        node => node.id === this.selectedTaskId,
      );
      const next =
        current < 0
          ? 0
          : (current + direction + matching.length) % matching.length;
      const node = matching[next];
      if (node === undefined) return {matched: true, selectionChanged: false};
      const previousTaskId = this.selectedTaskId;
      const previousIndex = this.selectedOverviewIndex;
      this.selectOverviewIndex(model.nodes.indexOf(node), snapshot);
      return {
        matched: true,
        selectionChanged:
          previousTaskId !== this.selectedTaskId ||
          previousIndex !== this.selectedOverviewIndex,
      };
    }

    return {matched: false, selectionChanged: false};
  }

  private scrollValue(target: 'main' | 'summary' | 'reader'): number {
    if (target === 'summary') return this.summaryOffset;
    if (target === 'reader') return this.readerOffset;
    return this.scrollOffset;
  }

  private writeScrollValue(
    target: 'main' | 'summary' | 'reader',
    value: number,
  ): void {
    if (target === 'summary') this.summaryOffset = value;
    else if (target === 'reader') this.readerOffset = value;
    else this.scrollOffset = value;
  }

  private initializeSections(snapshot: FleetRecord, taskId: string): void {
    if (this.openSectionsByTask.has(taskId)) return;
    const task = snapshot.tasks.find(item => item.id === taskId);
    const open = new Set<DetailSection>(['prompt']);
    if (task?.phase === 'ended')
      open.add(task.outcome === 'fulfilled' ? 'result' : 'progress');
    else open.add('progress');
    this.openSectionsByTask.set(taskId, open);
  }
}
