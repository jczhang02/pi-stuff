import type {
  ExtensionContext,
  KeybindingsManager,
  ReadonlyFooterDataProvider,
  Theme,
} from '@earendil-works/pi-coding-agent';
import {
  getKeybindings,
  Key,
  matchesKey,
  parseKey,
  type EditorTheme,
  type TUI,
} from '@earendil-works/pi-tui';
import type {Coordinator} from '../coordinator';
import {isPendingQuestion} from '../coordinator-mailbox';
import type {FleetRecord, TaskRecord} from '../records';
import type {SubagentSettings} from '../settings';
import {taskForAgent} from './format';
import {FleetFooter, type FleetFooterState} from './footer';
import {TargetedActionController, type TargetedActionHost} from './actions';
import {
  configuredShortcut,
  SubagentEditor,
  type SubagentEditorHost,
} from './editor';
import {childrenOf, overviewModels} from './navigation';
import {
  inspectionSelectionOffset,
  renderInspection,
  type RenderState,
} from './render';
import {ReaderStore} from './reader';
import {detailSections, sectionLabels} from './sections';
import {BrowseNavigator} from './browser';
import {END_SCROLL_OFFSET} from './types';
import type {
  ActionKind,
  DetailSection,
  DraftTarget,
  InspectSurface,
} from './types';

interface ShortcutResolution {
  readonly shortcut: string;
  readonly blocked: boolean;
  readonly warning: string | undefined;
}

export class SubagentUIController
  implements SubagentEditorHost, FleetFooterState
{
  private readonly shortcut: string;
  private readonly shortcutBlocked: boolean;
  private readonly shortcutConflictText: string | undefined;
  private snapshotRecord: FleetRecord;
  private editor: SubagentEditor | undefined;
  private footer: FleetFooter | undefined;
  private tui: TUI | undefined;
  private theme: Theme | undefined;
  private readonly navigation = new BrowseNavigator();
  private readonly readerStore = new ReaderStore();
  private readonly targetedActions: TargetedActionController;
  private readonly openSectionsByTask = new Map<string, Set<DetailSection>>();
  private actions: readonly ActionKind[] = [];
  private notice: string | undefined;
  private searchReturnSurface: InspectSurface | undefined;
  private detailUnread = 0;
  private detailActivityStamp: string | undefined;
  private graphRevealPending = false;
  private inspectionViewport: string | undefined;
  private detailRevealPending = false;
  private viewGeneration = 0;
  private disposed = false;

  constructor(
    private readonly context: ExtensionContext,
    private readonly coordinator: Coordinator,
    settings: SubagentSettings,
  ) {
    this.snapshotRecord = coordinator.snapshot;
    const actionHost: TargetedActionHost = {
      snapshot: () => this.snapshotRecord,
      selectedTask: () => this.selectedTask(),
      selectedTaskId: () => this.navigation.selectedTaskId,
      editor: () => this.editor,
      coordinator: () => this.coordinator,
      pushFrame: () => this.navigation.pushFrame(),
      setSurface: surface => {
        this.navigation.surface = surface;
        this.viewGeneration++;
      },
      setActionIndex: index => {
        this.navigation.selectedActionIndex = index;
      },
      setNotice: notice => {
        this.notice = notice;
      },
      notify: (message, type) => this.context.ui.notify(message, type),
      readerText: task =>
        this.readerStore.text(this.snapshotRecord, task, 'result'),
      viewGeneration: () => this.viewGeneration,
      back: () => this.back(),
      backToDetail: () => this.backToDetail(),
      backToFleet: () => this.backToFleet(),
      requestRender: () => this.requestRender(),
    };
    this.targetedActions = new TargetedActionController(actionHost);
    const resolved = resolveShortcut(
      configuredShortcut(settings.inspectShortcut),
    );
    this.shortcut = resolved.shortcut;
    this.shortcutBlocked = resolved.blocked;
    this.shortcutConflictText = resolved.warning;
  }

  createEditor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
  ): SubagentEditor {
    const editor = new SubagentEditor(tui, theme, keybindings);
    editor.attachInspector(this);
    this.editor = editor;
    this.tui = tui;
    this.theme = this.context.ui.theme;
    if (this.navigation.surface !== undefined) editor.enterInspection();
    return editor;
  }

  createFooter(
    tui: TUI,
    theme: Theme,
    footerData: ReadonlyFooterDataProvider,
  ): FleetFooter {
    this.tui = tui;
    this.theme = theme;
    this.footer?.dispose();
    const footer = new FleetFooter(tui, theme, footerData, this, () =>
      tui.requestRender(),
    );
    this.footer = footer;
    return footer;
  }

  isInspecting(): boolean {
    return this.navigation.surface !== undefined;
  }

  inspecting(): boolean {
    return this.navigation.surface !== undefined;
  }

  isInspectShortcut(data: string): boolean {
    return !this.shortcutBlocked && parseKey(data) === this.shortcut;
  }

  noteShortcutConflict(): void {
    this.notice =
      this.shortcutConflictText ??
      `Inspect agents is bound to ${this.shortcut}, but another extension handled that key.`;
    this.context.ui.notify(this.notice, 'warning');
    this.requestRender();
  }

  enterFromMain(_editor: SubagentEditor): void {
    this.open('fleet');
  }

  returnToMain(): void {
    this.closeToMain();
  }

  renderInspection(width: number, editorLines?: readonly string[]): string[] {
    const theme = this.theme;
    if (theme === undefined || this.navigation.surface === undefined) return [];
    const viewport = `${width}x${this.tui?.terminal.rows ?? 24}`;
    const resized = this.inspectionViewport !== viewport;
    this.inspectionViewport = viewport;
    const graphViewportReveal =
      this.navigation.surface === 'overview' &&
      (this.graphRevealPending || resized);
    if (graphViewportReveal) {
      this.navigation.ensureOverviewSelectionVisible(
        this.snapshotRecord,
        width,
      );
    }
    let state: RenderState = {
      snapshot: this.snapshotRecord,
      theme,
      now: Date.now(),
      surface: this.navigation.surface,
      selectedAgentId: this.navigation.selectedAgentId,
      selectedTaskId: this.navigation.selectedTaskId,
      selectedHistoryTaskId: this.navigation.selectedHistoryTaskId,
      selectedDispatchId: this.navigation.selectedDispatchId,
      overviewRootTaskId: this.navigation.overviewRootTaskId,
      selectedFleetIndex: this.navigation.selectedFleetIndex,
      selectedOverviewIndex: this.navigation.selectedOverviewIndex,
      selectedDetailSection: this.navigation.selectedDetailSection,
      selectedActionIndex: this.navigation.selectedActionIndex,
      openSections: this.openSections(),
      pane: this.navigation.pane,
      graphPan: this.navigation.graphPan,
      scrollOffset: this.navigation.scrollOffset,
      summaryOffset: this.navigation.summaryOffset,
      readerLines: this.readerStore.lines(width),
      readerTitle: this.readerStore.current?.title ?? '',
      readerOffset: this.navigation.readerOffset,
      readerQuery: this.readerStore.query,
      readerFollowing: this.readerStore.isFollowing,
      readerLoading: this.readerStore.isLoading,
      readerUnread: this.readerStore.unread,
      detailUnread: this.detailUnread,
      actions: this.actions,
      draftTarget: this.editor?.draftTargetValue(),
      notice: this.notice,
      lateSteerText: this.targetedActions.lateSteer(),
      stopTaskIds: this.targetedActions.stopTaskIdsState(),
      stopConfirm: this.targetedActions.stopConfirmState(),
      attentionOnly: this.navigation.attentionOnly,
      editorLines,
      terminalRows: this.tui?.terminal.rows ?? 24,
      inspectShortcut: this.shortcut,
      inspectShortcutBlocked: this.shortcutBlocked,
    };
    if (
      this.detailRevealPending ||
      graphViewportReveal ||
      (resized && this.navigation.surface === 'detail')
    ) {
      const offset = inspectionSelectionOffset(state, width);
      this.navigation.scrollOffset = offset;
      state = {...state, scrollOffset: offset};
      this.detailRevealPending = false;
      this.graphRevealPending = false;
    }
    return renderInspection(state, width);
  }

  handleInspectionInput(data: string, _editor: SubagentEditor): void {
    if (this.navigation.surface === undefined) return;
    if (this.matchesCancel(data)) {
      this.back();
      return;
    }
    if (this.matchesQuestion(data)) {
      this.openHelp();
      return;
    }
    if (['actions', 'help', 'stop'].includes(this.navigation.surface)) {
      if (this.letter(data, 'u'))
        this.navigation.scrollOffset = Math.max(
          0,
          this.navigation.scrollOffset - this.halfPage(),
        );
      else if (this.letter(data, 'd'))
        this.navigation.scrollOffset = pageDown(
          this.navigation.scrollOffset,
          this.halfPage(),
        );
      else if (this.letter(data, 'g')) this.navigation.scrollOffset = 0;
      else if (data === 'G' || matchesKey(data, Key.shift('g')))
        this.navigation.scrollOffset = END_SCROLL_OFFSET;
      else {
        this.routeInspectionInput(data);
        return;
      }
      this.requestRender();
      return;
    }
    this.routeInspectionInput(data);
  }

  private routeInspectionInput(data: string): void {
    switch (this.navigation.surface) {
      case 'fleet':
        this.handleFleetInput(data);
        return;
      case 'overview':
        this.handleOverviewInput(data);
        return;
      case 'detail':
        this.handleDetailInput(data);
        return;
      case 'reader':
        this.handleReaderInput(data);
        return;
      case 'actions':
        this.handleActionsInput(data);
        return;
      case 'help':
        return;
      case 'late-steer':
        this.handleLateSteerInput(data);
        return;
      case 'stop':
        this.handleStopInput(data);
        return;
      case 'targeted':
        return;
    }
  }

  submitDraft(target: DraftTarget, text: string): void {
    if (target.operation === 'search') this.submitSearch(text);
    else void this.targetedActions.submit(target, text);
  }

  escapeDraft(target: DraftTarget, text: string): void {
    this.targetedActions.saveDraft(target, text);
  }

  snapshot(): FleetRecord {
    return this.snapshotRecord;
  }

  selectedAgentId(): string | undefined {
    return this.navigation.selectedAgentId;
  }

  now(): number {
    return Date.now();
  }

  footerContext(): ExtensionContext {
    return this.context;
  }

  sessionManager(): ExtensionContext['sessionManager'] {
    return this.context.sessionManager;
  }

  onSnapshotChanged(): void {
    this.snapshotRecord = this.coordinator.snapshot;
    const previousOverviewTaskId = this.navigation.selectedTaskId;
    this.navigation.reconcile(this.snapshotRecord);
    if (
      this.navigation.surface === 'overview' &&
      this.navigation.selectedTaskId !== previousOverviewTaskId
    )
      this.graphRevealPending = true;
    this.targetedActions.refreshStopPreview();
    const following = this.readerStore.isFollowing;
    this.readerStore.updateLatest(this.snapshotRecord);
    if (following) this.navigation.readerOffset = END_SCROLL_OFFSET;
    const selected = this.selectedTask();
    if (this.navigation.surface === 'detail' && selected !== undefined) {
      const nextStamp = detailActivityStamp(selected);
      if (
        this.detailActivityStamp !== undefined &&
        this.detailActivityStamp !== nextStamp
      )
        this.detailUnread++;
      this.detailActivityStamp = nextStamp;
    }
    this.requestRender();
  }

  open(surface: 'fleet' | 'overview'): void {
    if (this.disposed) return;
    if (this.context.mode !== 'tui') {
      this.context.ui.notify(
        'Subagent inspection requires Pi TUI mode.',
        'error',
      );
      return;
    }
    this.notice = this.shortcutConflictText;
    this.navigation.open(surface, this.snapshotRecord);
    this.markViewChanged();
    this.editor?.enterInspection();
    this.context.ui.setWorkingVisible(false);
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.markViewChanged();
    this.navigation.close();
    this.footer?.dispose();
    this.footer = undefined;
    this.editor?.leaveInspection();
    this.context.ui.setFooter(undefined);
    this.context.ui.setWorkingVisible(true);
    this.editor = undefined;
    this.tui = undefined;
  }

  private handleFleetInput(data: string): void {
    const rows = this.navigation.fleetRows(this.snapshotRecord);
    if (this.matchesDown(data))
      this.navigation.moveFleet(1, this.snapshotRecord);
    else if (this.matchesUp(data))
      this.navigation.moveFleet(-1, this.snapshotRecord);
    else if (this.letter(data, 'o')) this.openOverviewFromCurrent();
    else if (this.letter(data, 'a')) this.openActions();
    else if (this.letter(data, '/')) this.beginSearch();
    else if (this.letter(data, 'n')) this.findSurfaceMatch(1);
    else if (data === 'N' || matchesKey(data, Key.shift('n')))
      this.findSurfaceMatch(-1);
    else if (this.letter(data, 'g'))
      this.navigation.selectFleetIndex(0, this.snapshotRecord);
    else if (data === 'G' || matchesKey(data, Key.shift('g')))
      this.navigation.selectFleetIndex(rows.length - 1, this.snapshotRecord);
    else if (this.letter(data, 'u'))
      this.navigation.selectFleetIndex(
        this.navigation.selectedFleetIndex - 3,
        this.snapshotRecord,
      );
    else if (this.letter(data, 'd'))
      this.navigation.selectFleetIndex(
        this.navigation.selectedFleetIndex + 3,
        this.snapshotRecord,
      );
    else if (this.matchesConfirm(data)) this.openSelectedFleetRow();
    this.requestRender();
  }

  private handleOverviewInput(data: string): void {
    const previousTaskId = this.navigation.selectedTaskId;
    const previousDispatchId = this.navigation.selectedDispatchId;
    const ids = this.navigation.overviewTaskIds(this.snapshotRecord);
    if (this.matchesTab(data)) {
      this.navigation.pane =
        this.navigation.pane === 'items' ? 'summary' : 'items';
    } else if (this.navigation.pane === 'summary') {
      if (this.matchesDown(data))
        this.navigation.summaryOffset = Math.min(
          END_SCROLL_OFFSET,
          this.navigation.summaryOffset + 1,
        );
      else if (this.matchesUp(data))
        this.navigation.summaryOffset = Math.max(
          0,
          this.navigation.summaryOffset - 1,
        );
      else if (this.letter(data, 'u'))
        this.navigation.summaryOffset = Math.max(
          0,
          this.navigation.summaryOffset - this.halfPage(),
        );
      else if (this.letter(data, 'd'))
        this.navigation.summaryOffset = pageDown(
          this.navigation.summaryOffset,
          this.halfPage(),
        );
      else if (this.letter(data, 'g')) this.navigation.summaryOffset = 0;
      else if (data === 'G' || matchesKey(data, Key.shift('g')))
        this.navigation.summaryOffset = END_SCROLL_OFFSET;
      else if (this.letter(data, '/')) this.beginSearch();
      else if (this.letter(data, 'n')) this.findSurfaceMatch(1);
      else if (data === 'N' || matchesKey(data, Key.shift('n')))
        this.findSurfaceMatch(-1);
      else if (this.letter(data, 'a')) this.openActions();
      else if (this.matchesConfirm(data)) this.openSelectedOverview();
    } else if (this.matchesDown(data))
      this.navigation.moveOverview(1, this.snapshotRecord);
    else if (this.matchesUp(data))
      this.navigation.moveOverview(-1, this.snapshotRecord);
    else if (this.letter(data, 'h'))
      this.navigation.panOverview(
        -1,
        this.snapshotRecord,
        this.tui?.terminal.columns ?? 80,
      );
    else if (this.letter(data, 'l'))
      this.navigation.panOverview(
        1,
        this.snapshotRecord,
        this.tui?.terminal.columns ?? 80,
      );
    else if (this.letter(data, '['))
      this.navigation.moveOverviewDispatch(-1, this.snapshotRecord);
    else if (this.letter(data, ']'))
      this.navigation.moveOverviewDispatch(1, this.snapshotRecord);
    else if (this.letter(data, '/')) this.beginSearch();
    else if (this.letter(data, 'n')) this.findSurfaceMatch(1);
    else if (data === 'N' || matchesKey(data, Key.shift('n')))
      this.findSurfaceMatch(-1);
    else if (this.letter(data, 'a')) this.openActions();
    else if (this.letter(data, 'g'))
      this.navigation.selectOverviewIndex(0, this.snapshotRecord);
    else if (data === 'G' || matchesKey(data, Key.shift('g')))
      this.navigation.selectOverviewIndex(ids.length - 1, this.snapshotRecord);
    else if (this.letter(data, 'u'))
      this.navigation.scrollOffset = Math.max(
        0,
        this.navigation.scrollOffset - this.halfPage(),
      );
    else if (this.letter(data, 'd'))
      this.navigation.scrollOffset = pageDown(
        this.navigation.scrollOffset,
        this.halfPage(),
      );
    else if (this.matchesConfirm(data)) this.openSelectedOverview();
    if (
      this.navigation.selectedTaskId !== previousTaskId ||
      this.navigation.selectedDispatchId !== previousDispatchId
    )
      this.graphRevealPending = true;
    this.requestRender();
  }

  private handleDetailInput(data: string): void {
    const task = this.selectedTask();
    if (task === undefined) return;
    const previousSection = this.navigation.selectedDetailSection;
    const sections = detailSections;
    const index = sections.indexOf(this.navigation.selectedDetailSection);
    const historyOpen =
      this.navigation.selectedDetailSection === 'history' &&
      this.openSections().has('history');
    if (historyOpen && this.matchesDown(data))
      this.navigation.moveHistory(1, this.snapshotRecord);
    else if (historyOpen && this.matchesUp(data))
      this.navigation.moveHistory(-1, this.snapshotRecord);
    else if (this.matchesDown(data))
      this.navigation.selectedDetailSection =
        sections[Math.min(sections.length - 1, index + 1)] ?? 'prompt';
    else if (this.matchesUp(data))
      this.navigation.selectedDetailSection =
        sections[Math.max(0, index - 1)] ?? 'prompt';
    else if (this.letter(data, 'h'))
      this.openSections().delete(this.navigation.selectedDetailSection);
    else if (this.letter(data, 'l'))
      this.openSections().add(this.navigation.selectedDetailSection);
    else if (this.matchesConfirm(data)) this.openDetailSection();
    else if (this.letter(data, 'a')) this.openActions();
    else if (this.letter(data, 'u'))
      this.navigation.scrollOffset = Math.max(
        0,
        this.navigation.scrollOffset - this.halfPage(),
      );
    else if (this.letter(data, 'd'))
      this.navigation.scrollOffset = pageDown(
        this.navigation.scrollOffset,
        this.halfPage(),
      );
    else if (this.letter(data, 'g')) this.navigation.scrollOffset = 0;
    else if (data === 'G' || matchesKey(data, Key.shift('g')))
      this.navigation.scrollOffset = END_SCROLL_OFFSET;
    else if (this.letter(data, '/')) {
      this.openReader(
        sectionLabels[this.navigation.selectedDetailSection],
        this.readerStore.text(
          this.snapshotRecord,
          task,
          this.navigation.selectedDetailSection,
        ),
      );
      this.beginSearch();
    } else if (this.letter(data, 'f')) {
      this.openReader(
        'Progress',
        this.readerStore.text(this.snapshotRecord, task, 'progress'),
        'progress',
      );
      this.readerStore.setFollowing(true);
      this.navigation.readerOffset = END_SCROLL_OFFSET;
      this.detailUnread = 0;
    }
    if (this.navigation.selectedDetailSection !== previousSection)
      this.detailRevealPending = true;
    this.requestRender();
  }

  private handleReaderInput(data: string): void {
    if (this.letter(data, 'u')) {
      this.readerStore.setFollowing(false);
      this.navigation.readerOffset = Math.max(
        0,
        this.navigation.readerOffset - this.halfPage(),
      );
    } else if (this.letter(data, 'd')) {
      this.readerStore.setFollowing(false);
      this.navigation.readerOffset = pageDown(
        this.navigation.readerOffset,
        this.halfPage(),
      );
    } else if (this.letter(data, 'g')) {
      this.readerStore.setFollowing(false);
      this.navigation.readerOffset = 0;
    } else if (data === 'G' || matchesKey(data, Key.shift('g'))) {
      this.readerStore.setFollowing(false);
      this.navigation.readerOffset = END_SCROLL_OFFSET;
    } else if (this.letter(data, 'f')) {
      this.readerStore.setFollowing(!this.readerStore.isFollowing);
      if (this.readerStore.isFollowing)
        this.navigation.readerOffset = END_SCROLL_OFFSET;
    } else if (this.letter(data, 'n')) {
      this.readerStore.setFollowing(false);
      this.findReaderMatch(1);
    } else if (data === 'N' || matchesKey(data, Key.shift('n'))) {
      this.readerStore.setFollowing(false);
      this.findReaderMatch(-1);
    } else if (this.letter(data, '/')) {
      this.readerStore.setFollowing(false);
      this.beginSearch();
    }
    this.requestRender();
  }

  private handleActionsInput(data: string): void {
    const previousIndex = this.navigation.selectedActionIndex;
    if (this.matchesDown(data))
      this.navigation.selectedActionIndex = Math.min(
        this.actions.length - 1,
        this.navigation.selectedActionIndex + 1,
      );
    else if (this.matchesUp(data))
      this.navigation.selectedActionIndex = Math.max(
        0,
        this.navigation.selectedActionIndex - 1,
      );
    else if (this.matchesConfirm(data))
      this.activateAction(this.actions[this.navigation.selectedActionIndex]);
    if (previousIndex !== this.navigation.selectedActionIndex)
      this.detailRevealPending = true;
    this.requestRender();
  }

  private handleLateSteerInput(data: string): void {
    if (this.matchesDown(data) || this.matchesUp(data))
      this.navigation.selectedActionIndex =
        this.navigation.selectedActionIndex === 0 ? 1 : 0;
    else if (this.matchesConfirm(data)) {
      if (this.navigation.selectedActionIndex === 0)
        this.targetedActions.convertLateSteer();
      else this.targetedActions.keepLateSteer();
    }
    this.requestRender();
  }

  private handleStopInput(data: string): void {
    if (this.matchesDown(data) || this.matchesUp(data)) {
      this.targetedActions.toggleStopConfirmation();
      this.detailRevealPending = true;
    } else if (this.matchesConfirm(data)) {
      if (this.targetedActions.stopConfirmState())
        void this.targetedActions.confirmStop();
      else this.targetedActions.cancelStop();
    }
    this.requestRender();
  }

  private openHelp(): void {
    this.navigation.pushFrame();
    this.navigation.surface = 'help';
    this.markViewChanged();
    this.requestRender();
  }

  private openOverviewFromCurrent(): void {
    this.navigation.pushFrame();
    this.navigation.overviewRootTaskId = undefined;
    this.navigation.prepareOverview(this.snapshotRecord);
    this.navigation.surface = 'overview';
    this.markViewChanged();
    this.graphRevealPending = true;
  }

  private openSelectedFleetRow(): void {
    const row = this.navigation.fleetRows(this.snapshotRecord)[
      this.navigation.selectedFleetIndex
    ];
    if (row === undefined || row.id === 'main') this.closeToMain();
    else this.openDetail(taskForAgent(this.snapshotRecord, row.id)?.id);
  }

  private openSelectedOverview(): void {
    const model = overviewModels(
      this.snapshotRecord,
      this.navigation.overviewRootTaskId,
    ).find(item => item.dispatchId === this.navigation.selectedDispatchId);
    const node = model?.nodes[this.navigation.selectedOverviewIndex];
    if (node?.reference) {
      const sourceId = node.id.slice('reference:'.length);
      const source = this.snapshotRecord.tasks.find(
        task => task.id === sourceId,
      );
      if (source === undefined) {
        this.notice = `Saved input ${sourceId} is unavailable.`;
        return;
      }
      this.notice = `Following saved input ${source.id}.`;
      this.openDetail(source.id);
      return;
    }
    const task = this.selectedTask();
    if (task !== undefined) this.openDetail(task.id);
  }

  private openDetail(taskId: string | undefined): void {
    if (taskId === undefined) return;
    this.navigation.pushFrame();
    this.navigation.selectedTaskId = taskId;
    this.navigation.selectedHistoryTaskId = taskId;
    this.navigation.selectedAgentId =
      this.snapshotRecord.tasks.find(task => task.id === taskId)?.agentId ??
      this.navigation.selectedAgentId;
    this.navigation.selectedDetailSection = 'prompt';
    this.navigation.selectedActionIndex = 0;
    this.navigation.scrollOffset = 0;
    this.detailUnread = 0;
    this.detailActivityStamp = detailActivityStamp(
      this.snapshotRecord.tasks.find(task => task.id === taskId),
    );
    this.navigation.surface = 'detail';
    this.markViewChanged();
    this.initializeSections(taskId);
    this.detailRevealPending = true;
  }

  private openDetailSection(): void {
    const task = this.selectedTask();
    if (task === undefined) return;
    if (this.navigation.selectedDetailSection === 'history') {
      this.navigation.prepareHistory(this.snapshotRecord);
      const historyTask = this.snapshotRecord.tasks.find(
        candidate => candidate.id === this.navigation.selectedHistoryTaskId,
      );
      if (historyTask !== undefined && historyTask.id !== task.id) {
        this.openDetail(historyTask.id);
        return;
      }
    }
    if (
      this.navigation.selectedDetailSection === 'relations' &&
      childrenOf(this.snapshotRecord, task.id).length > 0
    ) {
      this.navigation.pushFrame();
      this.navigation.selectedDispatchId = task.dispatchId;
      this.navigation.overviewRootTaskId = task.id;
      this.navigation.prepareOverview(this.snapshotRecord);
      this.navigation.selectedTaskId = childrenOf(
        this.snapshotRecord,
        task.id,
      )[0]?.id;
      this.navigation.surface = 'overview';
      this.markViewChanged();
      this.graphRevealPending = true;
      return;
    }
    const title =
      this.navigation.selectedDetailSection[0]?.toUpperCase() +
      this.navigation.selectedDetailSection.slice(1);
    this.openReader(
      title,
      this.readerStore.text(
        this.snapshotRecord,
        task,
        this.navigation.selectedDetailSection,
      ),
    );
  }

  private openReader(
    title: string,
    text: string,
    section = this.navigation.selectedDetailSection,
  ): void {
    this.navigation.pushFrame();
    const task = this.selectedTask();
    this.readerStore.open(title, text, task?.id, section);
    this.navigation.readerOffset = 0;
    this.navigation.surface = 'reader';
    this.markViewChanged();
    if (task !== undefined) void this.loadFullReader(task, section);
  }

  private openActions(): void {
    if (
      this.selectedTask() === undefined &&
      this.navigation.surface !== 'fleet'
    )
      return;
    this.navigation.pushFrame();
    this.actions = this.availableActions();
    this.navigation.selectedActionIndex = 0;
    this.navigation.surface = 'actions';
    this.markViewChanged();
  }

  private activateAction(action: ActionKind | undefined): void {
    if (action === undefined) return;
    if (action === 'attention') {
      const wasAttentionOnly = this.navigation.attentionOnly;
      this.navigation.toggleAttention(this.snapshotRecord);
      this.notice = this.navigation.attentionOnly
        ? 'Showing assignments that need attention.'
        : 'Attention filter cleared.';
      this.back();
      if (wasAttentionOnly) {
        this.navigation.restoreAttentionSelection(this.snapshotRecord);
        this.requestRender();
      }
      return;
    }
    const task = this.selectedTask();
    if (task === undefined) {
      if (action === 'reply') {
        const question = this.pendingMainQuestion();
        if (question !== undefined)
          this.targetedActions.startMainReply(
            question.id,
            question.questionId ?? question.id,
            question.text,
          );
      }
      return;
    }
    switch (action) {
      case 'inspect':
        this.back();
        if (
          this.navigation.surface !== 'detail' ||
          this.navigation.selectedTaskId !== task.id
        )
          this.openDetail(task.id);
        return;
      case 'reader':
        this.back();
        this.openReader(
          'Result',
          this.readerStore.text(this.snapshotRecord, task, 'result'),
          'result',
        );
        return;
      case 'copy':
        void this.targetedActions.copyTask(task);
        return;
      case 'children': {
        const child = childrenOf(this.snapshotRecord, task.id)[0];
        if (child === undefined) return;
        this.navigation.selectedTaskId = child.id;
        this.navigation.selectedDispatchId = child.dispatchId;
        this.navigation.overviewRootTaskId = task.id;
        this.navigation.prepareOverview(this.snapshotRecord);
        this.navigation.surface = 'overview';
        this.markViewChanged();
        this.graphRevealPending = true;
        return;
      }
      case 'message':
      case 'steer':
      case 'reply':
      case 'followup':
        this.targetedActions.startDraft(action, task);
        return;
      case 'stop':
        this.targetedActions.startStop(task);
        return;
      case 'release':
        void this.targetedActions.release(task);
        return;
      case 'recover':
        this.targetedActions.startRecovery(task);
        return;
      case 'queue':
        this.notice = 'Choose Continue or Cancel to record the queue decision.';
        return;
      case 'queue-continue':
        void this.targetedActions.runQueue(task, 'continue');
        return;
      case 'queue-cancel':
        void this.targetedActions.runQueue(task, 'cancel');
        return;
      case 'acknowledge':
        void this.targetedActions.acknowledge(task);
        return;
    }
  }

  private beginSearch(): void {
    this.navigation.pushFrame();
    this.searchReturnSurface = this.navigation.surface;
    this.navigation.surface = 'targeted';
    this.markViewChanged();
    const target: DraftTarget = {
      operation: 'search',
      taskId: this.navigation.selectedTaskId ?? '',
      recipient: 'current surface',
      summary:
        'Search retained records or the current list. Enter applies the query.',
    };
    this.editor?.beginDraft(target, this.readerStore.query);
  }

  private submitSearch(text: string): void {
    this.readerStore.setQuery(text.trim());
    this.editor?.clearDraft();
    const returnSurface = this.searchReturnSurface;
    this.searchReturnSurface = undefined;
    this.back();
    if (returnSurface === 'reader') {
      const match = this.readerStore.firstMatch(
        this.tui?.terminal.columns ?? 80,
      );
      if (match >= 0) this.navigation.readerOffset = match;
      this.notice =
        match < 0 ? `No matches for ${this.readerStore.query}` : undefined;
    } else {
      this.findSurfaceMatch(1);
    }
    this.requestRender();
  }

  private backToDetail(): void {
    while (this.navigation.surface !== 'detail' && this.navigation.hasFrames())
      this.back();
    if (
      this.navigation.surface !== 'detail' &&
      this.navigation.selectedTaskId !== undefined
    ) {
      this.navigation.surface = 'detail';
      this.markViewChanged();
    }
  }

  private backToFleet(): void {
    while (this.navigation.surface !== 'fleet' && this.navigation.hasFrames())
      this.back();
    if (this.navigation.surface !== 'fleet') {
      this.navigation.surface = 'fleet';
      this.markViewChanged();
    }
  }

  private back(): void {
    this.editor?.clearDraft();
    if (!this.navigation.popFrame()) {
      this.closeToMain();
      return;
    }
    this.markViewChanged();
    this.navigation.reconcile(this.snapshotRecord);
    this.requestRender();
  }

  private closeToMain(): void {
    this.markViewChanged();
    this.navigation.close();
    this.editor?.leaveInspection();
    this.context.ui.setWorkingVisible(true);
    this.notice = undefined;
    this.requestRender();
  }

  private initializeSections(taskId: string): void {
    if (this.openSectionsByTask.has(taskId)) return;
    const task = this.snapshotRecord.tasks.find(item => item.id === taskId);
    const open = new Set<DetailSection>(['prompt']);
    if (task?.phase === 'ended')
      open.add(task.outcome === 'fulfilled' ? 'result' : 'progress');
    else open.add('progress');
    this.openSectionsByTask.set(taskId, open);
  }

  private openSections(): Set<DetailSection> {
    if (this.navigation.selectedTaskId === undefined)
      return new Set<DetailSection>();
    this.initializeSections(this.navigation.selectedTaskId);
    return (
      this.openSectionsByTask.get(this.navigation.selectedTaskId) ??
      new Set<DetailSection>()
    );
  }

  private selectedTask(): TaskRecord | undefined {
    return this.navigation.selectedTaskId === undefined
      ? undefined
      : this.snapshotRecord.tasks.find(
          task => task.id === this.navigation.selectedTaskId,
        );
  }

  private availableActions(): readonly ActionKind[] {
    const task = this.selectedTask();
    const actions: ActionKind[] =
      this.navigation.surface === 'fleet' ? ['attention'] : [];
    if (task === undefined) {
      if (this.pendingMainQuestion() !== undefined) actions.push('reply');
      return actions;
    }
    actions.push('inspect', 'reader', 'copy');
    if (childrenOf(this.snapshotRecord, task.id).length > 0)
      actions.push('children');
    if (task.phase !== 'ended') actions.push('message', 'steer', 'stop');
    const question = this.pendingQuestionForTask(task.id) !== undefined;
    if (question) actions.push('reply');
    if (task.phase === 'ended') actions.push('followup');
    const agent = this.snapshotRecord.agents.find(
      item => item.id === task.agentId,
    );
    if (agent?.released === false && task.phase === 'ended')
      actions.push('release');
    if (
      task.phase === 'unknown' ||
      task.phase === 'cancelling' ||
      task.durability === 'failed'
    )
      actions.push('recover');
    if (
      task.phase === 'queued' ||
      task.phase === 'waiting' ||
      this.snapshotRecord.agents.find(agent => agent.id === task.agentId)?.held
    ) {
      actions.push('queue-continue', 'queue-cancel');
    }
    if (
      this.snapshotRecord.notices.some(
        notice => notice.taskId === task.id && !notice.acknowledged,
      )
    )
      actions.push('acknowledge');
    return actions;
  }

  private pendingMainQuestion() {
    return this.pendingQuestionForTask(null);
  }

  private pendingQuestionForTask(taskId: string | null) {
    return this.snapshotRecord.messages.find(message => {
      if (!isPendingQuestion(this.snapshotRecord, message)) return false;
      if (message.taskId === taskId) return true;
      return (
        taskId !== null &&
        message.taskId === null &&
        message.fromTaskId === taskId
      );
    });
  }

  private async loadFullReader(
    task: TaskRecord,
    section: string,
  ): Promise<void> {
    if (section !== 'result') return;
    this.notice = 'Loading the full retained record...';
    this.requestRender();
    try {
      await this.readerStore.loadFull(this.coordinator, task, section);
      this.notice = undefined;
    } catch (error) {
      this.notice = `Full record unavailable: ${error instanceof Error ? error.message : 'read operation failed'}`;
      this.context.ui.notify(this.notice, 'error');
    } finally {
      this.requestRender();
    }
  }

  private findReaderMatch(direction: -1 | 1): void {
    const width = this.tui?.terminal.columns ?? 80;
    const lines = this.readerStore.lines(width);
    const offset =
      this.navigation.readerOffset >= END_SCROLL_OFFSET / 2
        ? Math.max(0, lines.length - 1)
        : this.navigation.readerOffset;
    const match = this.readerStore.findMatch(width, direction, offset);
    if (match !== undefined) this.navigation.readerOffset = match;
    this.notice =
      match === undefined && this.readerStore.query
        ? `No matches for ${this.readerStore.query}`
        : undefined;
  }

  private findSurfaceMatch(direction: -1 | 1): void {
    const query = this.readerStore.query.trim().toLocaleLowerCase();
    this.notice = query
      ? `No matches for ${this.readerStore.query}`
      : undefined;
    if (!query) return;
    if (this.navigation.surface === 'fleet') {
      const rows = this.navigation.fleetRows(this.snapshotRecord);
      const matching = rows.filter(row => {
        if (row.id === 'main') return 'main'.includes(query);
        const agent = this.snapshotRecord.agents.find(
          candidate => candidate.id === row.id,
        );
        const task = taskForAgent(this.snapshotRecord, row.id);
        return `${agent?.name ?? ''} ${task?.description ?? ''} ${task?.prompt ?? ''}`
          .toLocaleLowerCase()
          .includes(query);
      });
      if (matching.length === 0) return;
      this.notice = `Search: ${this.readerStore.query}`;
      const current = matching.findIndex(
        row => row.id === this.navigation.selectedAgentId,
      );
      const next =
        current < 0
          ? 0
          : (current + direction + matching.length) % matching.length;
      const row = matching[next];
      if (row !== undefined)
        this.navigation.selectFleetIndex(
          rows.indexOf(row),
          this.snapshotRecord,
        );
      return;
    }
    if (this.navigation.surface === 'overview') {
      const models = overviewModels(
        this.snapshotRecord,
        this.navigation.overviewRootTaskId,
      );
      const model = models.find(
        candidate =>
          candidate.dispatchId === this.navigation.selectedDispatchId,
      );
      if (model === undefined) return;
      const matching = model.nodes.filter(node => {
        const task = node.task;
        const agent = task
          ? this.snapshotRecord.agents.find(
              candidate => candidate.id === task.agentId,
            )
          : undefined;
        return `${node.label} ${agent?.name ?? ''} ${task?.prompt ?? ''}`
          .toLocaleLowerCase()
          .includes(query);
      });
      if (matching.length === 0) return;
      this.notice = `Search: ${this.readerStore.query}`;
      const current = matching.findIndex(
        node => node.id === this.navigation.selectedTaskId,
      );
      const next =
        current < 0
          ? 0
          : (current + direction + matching.length) % matching.length;
      const node = matching[next];
      if (node !== undefined) {
        this.navigation.selectOverviewIndex(
          model.nodes.indexOf(node),
          this.snapshotRecord,
        );
        this.graphRevealPending = true;
      }
    }
  }

  private matchesDown(data: string): boolean {
    return (
      getKeybindings().matches(data, 'tui.select.down') ||
      matchesKey(data, Key.down) ||
      this.letter(data, 'j')
    );
  }

  private matchesUp(data: string): boolean {
    return (
      getKeybindings().matches(data, 'tui.select.up') ||
      matchesKey(data, Key.up) ||
      this.letter(data, 'k')
    );
  }

  private matchesConfirm(data: string): boolean {
    return (
      getKeybindings().matches(data, 'tui.select.confirm') ||
      matchesKey(data, Key.enter)
    );
  }

  private matchesCancel(data: string): boolean {
    return matchesKey(data, Key.escape) || this.letter(data, 'q');
  }

  private matchesQuestion(data: string): boolean {
    return this.letter(data, '?');
  }

  private matchesTab(data: string): boolean {
    return matchesKey(data, Key.tab) || matchesKey(data, Key.shift('tab'));
  }

  private letter(data: string, key: string): boolean {
    const parsed = parseKey(data);
    return data === key || parsed === key;
  }

  private halfPage(): number {
    return Math.max(1, Math.floor((this.tui?.terminal.rows ?? 24) / 2));
  }

  private requestRender(): void {
    this.tui?.requestRender();
  }

  private markViewChanged(): void {
    this.viewGeneration++;
  }
}

function pageDown(offset: number, amount: number): number {
  return Math.min(END_SCROLL_OFFSET, offset + amount);
}

function resolveShortcut(requested: string): ShortcutResolution {
  const resolved = getKeybindings().getResolvedBindings();
  const conflicts = (shortcut: string): readonly string[] =>
    Object.entries(resolved)
      .filter(
        ([, value]) =>
          value === shortcut ||
          (Array.isArray(value) &&
            value.some(item => String(item) === shortcut)),
      )
      .map(([name]) => name);
  const requestedConflicts = conflicts(requested);
  if (requestedConflicts.length === 0)
    return {shortcut: requested, blocked: false, warning: undefined};
  return {
    shortcut: requested,
    blocked: true,
    warning: `Inspect agents shortcut ${requested} conflicts with ${requestedConflicts.join(', ')} and is unavailable. Configure inspectShortcut to remap it.`,
  };
}

function detailActivityStamp(task: TaskRecord | undefined): string | undefined {
  if (task === undefined) return undefined;
  return JSON.stringify({
    taskId: task.id,
    phase: task.phase,
    lastEventAt: task.lastEventAt,
    eventCount: task.events.length,
    liveText: task.liveText,
    activeTools: task.activeTools.map(tool => [
      tool.name,
      tool.progress,
      tool.startedAt,
    ]),
  });
}
