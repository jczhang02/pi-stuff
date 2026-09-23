import {
  type KeybindingsManager,
  ExtensionEditorComponent,
  ExtensionInputComponent,
} from '@earendil-works/pi-coding-agent';
import {Container, type Focusable, type TUI} from '@earendil-works/pi-tui';

// Pi owns editing and cancellation. This owner only keeps a submitted draft
// available until its asynchronous configuration write succeeds.
export class NamingTextEditor extends Container implements Focusable {
  private control: ExtensionEditorComponent | ExtensionInputComponent;
  private pending = false;
  private closed = false;
  get focused() {
    return this.control.focused;
  }
  set focused(value: boolean) {
    this.control.focused = value;
  }
  constructor(
    tui: TUI,
    private readonly keys: KeybindingsManager,
    title: string,
    initial: string,
    multiline: boolean,
    save: (value: string) => Promise<void>,
    done: () => void,
    notifyError: (message: string) => void,
  ) {
    super();
    const create = (
      value: string,
    ): ExtensionEditorComponent | ExtensionInputComponent =>
      multiline
        ? new ExtensionEditorComponent(tui, keys, title, value, submit, done)
        : new ExtensionInputComponent(
            `${title} (current: ${initial})`,
            undefined,
            submit,
            done,
          );
    const submit = (value: string) => {
      if (this.closed) return;
      if (multiline) {
        // Native submission clears its editor. Recreate it with the submitted
        // text, including repeated submissions during a pending write.
        const focused = this.focused;
        this.control = create(value);
        this.clear();
        this.addChild(this.control);
        this.focused = focused;
      }
      if (this.pending) return;
      this.pending = true;
      void save(value)
        .then(() => {
          if (!this.closed) done();
        })
        .catch(error =>
          notifyError(
            error instanceof Error
              ? error.message
              : 'Could not save this setting.',
          ),
        )
        .finally(() => {
          this.pending = false;
          if (!this.closed) tui.requestRender();
        });
    };
    this.control = create(initial);
    this.addChild(this.control);
  }
  handleInput(data: string) {
    // Freeze the submitted value while saving. The native dialog still owns
    // cancellation, including the user's configured binding.
    if (!this.pending || this.keys.matches(data, 'tui.select.cancel'))
      this.control.handleInput(data);
  }
  dispose() {
    this.closed = true;
    if (this.control instanceof ExtensionInputComponent) this.control.dispose();
  }
}
