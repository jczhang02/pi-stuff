import type {FleetRecord} from '../records';
import type {BrowsePane, DetailSection, InspectSurface} from './types';
import {computeDependencyGraphGeometry} from './graph';
import {dispatchOrder, overviewModels, retainedAgents} from './navigation';
import {taskForAgent, taskNeedsAttention} from './format';

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

  fleetRows(snapshot: FleetRecord): readonly FleetRowSelection[] {
    const agents = retainedAgents(snapshot).filter(agent => {
      if (!this.attentionOnly) return true;
      return taskNeedsAttention(snapshot, taskForAgent(snapshot, agent.id));
    });
    return [{id: 'main'}, ...agents.map(agent => ({id: agent.id}))];
  }

  currentTaskForAgent(snapshot: FleetRecord): string | undefined {
    if (this.selectedAgentId === 'main') return undefined;
    return taskForAgent(snapshot, this.selectedAgentId)?.id;
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

  moveHistory(direction: -1 | 1, snapshot: FleetRecord): void {
    const ids = this.historyTaskIds(snapshot);
    if (ids.length === 0) return;
    const current = Math.max(0, ids.indexOf(this.selectedHistoryTaskId ?? ''));
    this.selectedHistoryTaskId =
      ids[Math.max(0, Math.min(ids.length - 1, current + direction))];
  }
}
