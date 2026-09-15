import {CustomEditor} from '@earendil-works/pi-coding-agent';
import {getKeybindings} from '@earendil-works/pi-tui';

/** Pi 0.85.1 draws its software cursor even when an editor loses focus. */
export class MainEditor extends CustomEditor {
  onFleetEntry?: () => void;

  override handleInput(data: string): void {
    const keys = getKeybindings();
    const arrow =
      keys.matches(data, 'tui.editor.cursorUp') ||
      keys.matches(data, 'tui.editor.cursorDown');
    if (!arrow || this.isShowingAutocomplete()) {
      super.handleInput(data);
      return;
    }
    const beforeText = this.getText();
    const before = this.getCursor();
    // History can advance to an identical entry without changing text/cursor.
    let historyChanged = false;
    const onChange = this.onChange;
    this.onChange = text => {
      historyChanged = true;
      onChange?.(text);
    };
    try {
      super.handleInput(data);
    } finally {
      if (onChange) this.onChange = onChange;
      else delete this.onChange;
    }
    if (historyChanged || !this.focused) return;
    const after = this.getCursor();
    if (
      this.getText() === beforeText &&
      before.line === after.line &&
      before.col === after.col
    )
      this.onFleetEntry?.();
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    return this.focused
      ? lines
      : lines.map(line => line.replaceAll('\x1b[7m', ''));
  }
}
