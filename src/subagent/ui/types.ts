import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from '@earendil-works/pi-coding-agent';
import type {Editor, EditorTheme, TUI} from '@earendil-works/pi-tui';
import type {Coordinator} from '../coordinator';
import type {AgentRecord, FleetRecord, TaskRecord} from '../records';
import type {SubagentInput} from '../protocol';
import type {SubagentSettings} from '../settings';

/** Offset used by browse surfaces to pin the viewport to the retained end. */
export const END_SCROLL_OFFSET = Number.MAX_SAFE_INTEGER;

export type InspectSurface =
  | 'fleet'
  | 'overview'
  | 'detail'
  | 'reader'
  | 'actions'
  | 'help'
  | 'targeted'
  | 'late-steer'
  | 'stop';

export type BrowsePane = 'items' | 'summary';

export type DetailSection =
  | 'prompt'
  | 'progress'
  | 'result'
  | 'communication'
  | 'relations'
  | 'configuration'
  | 'workspace'
  | 'history';

export type ActionKind =
  | 'inspect'
  | 'attention'
  | 'copy'
  | 'reader'
  | 'children'
  | 'message'
  | 'steer'
  | 'reply'
  | 'followup'
  | 'stop'
  | 'release'
  | 'recover'
  | 'queue'
  | 'queue-continue'
  | 'queue-cancel'
  | 'acknowledge';

export type DraftOperation =
  | Exclude<
      ActionKind,
      | 'inspect'
      | 'attention'
      | 'copy'
      | 'reader'
      | 'children'
      | 'stop'
      | 'release'
      | 'recover'
      | 'queue'
      | 'queue-continue'
      | 'queue-cancel'
      | 'acknowledge'
    >
  | 'search';

export interface DraftTarget {
  readonly operation: DraftOperation;
  readonly taskId: string;
  readonly questionId?: string;
  readonly recovery?: boolean;
  readonly recipient: string;
  readonly summary: string;
}

export interface NoticeState {
  readonly message: string;
  readonly kind: 'info' | 'warning' | 'error';
}

export interface UIEnvironment {
  readonly pi: ExtensionAPI;
  readonly context: ExtensionContext;
  readonly coordinator: Coordinator;
  readonly settings: SubagentSettings;
}

export interface EditorFactoryArgs {
  readonly tui: TUI;
  readonly theme: EditorTheme;
  readonly keybindings: KeybindingsManager;
}

export interface InspectorEditor {
  readonly tui: TUI;
  readonly theme: Theme;
  readonly editorTheme: EditorTheme;
  readonly getMainText: () => string;
  readonly startDraft: (target: DraftTarget, prefill: string) => void;
  readonly saveDraft: (target: DraftTarget, text: string) => void;
  readonly cancelDraft: () => void;
  readonly draftEditor: () => Editor | undefined;
  readonly openInspection: (surface: 'fleet' | 'overview') => void;
}

export interface TaskLookup {
  readonly task: TaskRecord;
  readonly agent: AgentRecord | undefined;
}

export interface SnapshotListener {
  readonly snapshot: FleetRecord;
  readonly now: number;
}

export interface InspectRenderer {
  render(width: number, editorLines?: readonly string[]): string[];
  handleInput(data: string): void;
  dispose(): void;
}

export interface MainEditorCallbacks {
  onEnter: () => void;
  onReturn: () => void;
  onRender: (width: number, editorLines?: readonly string[]) => string[];
  onInput: (data: string) => void;
  onDraftSubmit: (target: DraftTarget, text: string) => void;
  onDraftEscape: (target: DraftTarget, text: string) => void;
}

export interface GraphNode {
  readonly id: string;
  readonly task: TaskRecord | undefined;
  readonly reference: boolean;
  readonly label: string;
  readonly level: number;
}

export interface OverviewModel {
  readonly dispatchId: string;
  readonly title: string;
  readonly taskIds: readonly string[];
  readonly hasDependencies: boolean;
  readonly nodes: readonly GraphNode[];
}

export interface SelectionState {
  fleetAgentId: string | undefined;
  overviewTaskId: string | undefined;
  detailSection: DetailSection;
  actionIndex: number;
  itemOffset: number;
  summaryOffset: number;
  readerOffset: number;
  readerFollowing: boolean;
  pane: BrowsePane;
}

export interface CompletionNotice {
  readonly text: string;
  readonly at: number;
}

export type ExecuteResult = Awaited<ReturnType<Coordinator['execute']>>;
export type UICommand = SubagentInput['command'];
