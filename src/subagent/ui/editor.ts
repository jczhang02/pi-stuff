import {CustomEditor} from '@earendil-works/pi-coding-agent';
import {
  Editor,
  getKeybindings,
  Key,
  matchesKey,
  type AutocompleteProvider,
  type EditorTheme,
  type SelectListTheme,
  type TUI,
} from '@earendil-works/pi-tui';
import type {KeybindingsManager} from '@earendil-works/pi-coding-agent';
import type {DraftTarget} from './types';

export interface SubagentEditorHost {
  isInspecting(): boolean;
  isInspectShortcut(data: string): boolean;
  noteShortcutConflict(): void;
  enterFromMain(editor: SubagentEditor): void;
  returnToMain(): void;
  renderInspection(width: number, editorLines?: readonly string[]): string[];
  handleInspectionInput(data: string, editor: SubagentEditor): void;
  submitDraft(target: DraftTarget, text: string): void;
  escapeDraft(target: DraftTarget, text: string): void;
}

export class SubagentEditor extends CustomEditor {
  private cachedAutocomplete: AutocompleteProvider | undefined;
  private inspector: SubagentEditorHost | undefined;
  private inspection = false;
  private draft: Editor | undefined;
  private draftTarget: DraftTarget | undefined;
  private draftEditRevision = 0;
  private submittedDraft:
    | {
        readonly target: DraftTarget;
        readonly text: string;
        readonly revision: number;
      }
    | undefined;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings, {embedWorkingStatus: true});
  }

  attachInspector(host: SubagentEditorHost): void {
    this.inspector = host;
  }

  override setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.cachedAutocomplete = provider;
    super.setAutocompleteProvider(provider);
    this.draft?.setAutocompleteProvider(provider);
  }

  enterInspection(): void {
    this.inspection = true;
    if (this.cachedAutocomplete !== undefined)
      super.setAutocompleteProvider(this.cachedAutocomplete);
    this.tui.setFocus(this);
    this.tui.requestRender();
  }

  leaveInspection(): void {
    this.finishDraftWithoutSubmission();
    this.inspection = false;
    this.tui.setFocus(this);
    this.tui.requestRender();
  }

  isInspectionOpen(): boolean {
    return this.inspection;
  }

  beginDraft(target: DraftTarget, prefill: string): void {
    this.inspection = true;
    this.draftTarget = target;
    this.draftEditRevision++;
    this.submittedDraft = undefined;
    this.draft = new Editor(this.tui, this.editorTheme(), {paddingX: 0});
    if (this.cachedAutocomplete !== undefined)
      this.draft.setAutocompleteProvider(this.cachedAutocomplete);
    this.draft.onChange = () => {
      this.draftEditRevision++;
      this.tui.requestRender();
    };
    this.draft.setText(prefill);
    this.draft.onSubmit = text => {
      this.submittedDraft = {
        target,
        text,
        revision: this.draftEditRevision,
      };
      this.inspector?.submitDraft(target, text);
    };
    this.tui.setFocus(this);
    this.tui.requestRender();
  }

  draftEditor(): Editor | undefined {
    return this.draft;
  }

  draftTargetValue(): DraftTarget | undefined {
    return this.draftTarget;
  }

  draftText(): string {
    return this.draft?.getExpandedText() ?? '';
  }

  draftRevision(): number {
    return this.draftEditRevision;
  }

  draftSubmission():
    | {
        readonly target: DraftTarget;
        readonly text: string;
        readonly revision: number;
      }
    | undefined {
    return this.submittedDraft;
  }

  clearDraft(): void {
    this.draft = undefined;
    this.draftTarget = undefined;
    this.submittedDraft = undefined;
  }

  override render(width: number): string[] {
    if (!this.inspection || this.inspector === undefined)
      return super.render(width);
    if (this.draft !== undefined) this.draft.focused = this.focused;
    const draftLines = this.draft?.render(Math.max(1, width - 2));
    return this.inspector.renderInspection(width, draftLines);
  }

  override handleInput(data: string): void {
    const inspector = this.inspector;
    if (!this.inspection || inspector === undefined) {
      const extensionHandled = this.onExtensionShortcut?.(data) ?? false;
      if (extensionHandled) {
        if (inspector?.isInspectShortcut(data))
          inspector.noteShortcutConflict();
        return;
      }
      if (inspector?.isInspectShortcut(data)) {
        inspector.enterFromMain(this);
        return;
      }
      if (this.isEditorEdgeArrow(data)) {
        if (this.isShowingAutocomplete()) {
          super.handleInput(data);
          return;
        }
        if (inspector !== undefined) this.handleEdgeArrow(data, inspector);
        else super.handleInput(data);
        return;
      }
      super.handleInput(data);
      return;
    }

    if (this.draft !== undefined && this.draftTarget !== undefined) {
      if (matchesKey(data, Key.escape)) {
        const target = this.draftTarget;
        const currentText = this.draft.getExpandedText();
        const submitted = this.submittedDraft;
        const text =
          submitted !== undefined &&
          submitted.revision === this.draftEditRevision
            ? submitted.text
            : currentText;
        inspector.escapeDraft(target, text);
        return;
      }
      if (matchesKey(data, Key.ctrl('c'))) {
        super.handleInput(data);
        return;
      }
      this.draft.focused = this.focused;
      this.draft.handleInput(data);
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.ctrl('c'))) {
      super.handleInput(data);
      return;
    }
    if (matchesKey(data, Key.ctrl('d'))) {
      inspector.returnToMain();
      super.handleInput(data);
      return;
    }
    inspector.handleInspectionInput(data, this);
  }

  private finishDraftWithoutSubmission(): void {
    this.draft = undefined;
    this.draftTarget = undefined;
    this.submittedDraft = undefined;
  }

  private isEditorEdgeArrow(data: string): boolean {
    const keys = getKeybindings();
    return (
      keys.matches(data, 'tui.editor.cursorUp') ||
      keys.matches(data, 'tui.editor.cursorDown')
    );
  }

  private handleEdgeArrow(data: string, inspector: SubagentEditorHost): void {
    const beforeText = this.getText();
    const beforeCursor = this.getCursor();
    let historyChanged = false;
    const previousOnChange = this.onChange;
    if (previousOnChange !== undefined) {
      this.onChange = text => {
        historyChanged = true;
        previousOnChange(text);
      };
    }
    try {
      super.handleInput(data);
    } finally {
      if (previousOnChange === undefined) delete this.onChange;
      else this.onChange = previousOnChange;
    }
    if (historyChanged || !this.focused) return;
    const afterCursor = this.getCursor();
    if (
      this.getText() === beforeText &&
      beforeCursor.line === afterCursor.line &&
      beforeCursor.col === afterCursor.col
    )
      inspector.enterFromMain(this);
  }

  private editorTheme(): EditorTheme {
    return {
      borderColor: text => this.borderColor(text),
      selectList: this.editorSelectTheme(),
    };
  }

  private editorSelectTheme(): SelectListTheme {
    return {
      selectedPrefix: text => text,
      selectedText: text => text,
      description: text => text,
      scrollInfo: text => text,
      noMatch: text => text,
    };
  }
}

export function configuredShortcut(
  settingsShortcut: string | undefined,
): string {
  const candidate = settingsShortcut?.trim();
  return candidate !== undefined && isSupportedShortcut(candidate)
    ? candidate.toLowerCase()
    : 'ctrl+q';
}

const shortcutModifiers = new Set(['ctrl', 'shift', 'alt', 'super']);
const shortcutSpecialKeys = new Set([
  'escape',
  'esc',
  'enter',
  'return',
  'tab',
  'space',
  'backspace',
  'delete',
  'insert',
  'clear',
  'home',
  'end',
  'pageup',
  'pagedown',
  'up',
  'down',
  'left',
  'right',
  ...Array.from({length: 12}, (_unused, index) => `f${index + 1}`),
]);
const shortcutSymbols = new Set(Array.from("`-=[]\\;',./!@#$%^&*()_|~{}:?<>"));

function isSupportedShortcut(candidate: string): boolean {
  const parts = candidate.toLowerCase().split('+');
  const key = parts.at(-1);
  if (key === undefined || key.length === 0) return false;
  const modifiers = parts.slice(0, -1);
  if (
    modifiers.some(modifier => !shortcutModifiers.has(modifier)) ||
    new Set(modifiers).size !== modifiers.length
  )
    return false;
  return (
    (key.length === 1 && (/[a-z0-9]/u.test(key) || shortcutSymbols.has(key))) ||
    shortcutSpecialKeys.has(key)
  );
}
