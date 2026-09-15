import {getSelectListTheme, type Theme} from '@earendil-works/pi-coding-agent';
import {
  Input,
  SelectList,
  Key,
  matchesKey,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui';
import {stripVTControlCharacters} from 'node:util';
import {RtkRuntime} from './runtime';

// Validation is temporary work. Only a successful probe reaches the durable save.
export class ExecutableEditor implements Component {
  private readonly choices: SelectList;
  private readonly input: Input;
  private mode: 'choice' | 'input' = 'choice';
  private pending: AbortController | undefined;
  private error = '';

  constructor(
    private readonly theme: Theme,
    current: string | undefined,
    initialPath: string,
    private readonly cwd: string,
    private readonly save: (path: string | undefined) => Promise<void>,
    private readonly done: (value?: string) => void,
    private readonly requestRender: () => void,
    private readonly notifyError: (message: string) => void,
  ) {
    this.choices = new SelectList(
      [
        {
          value: 'automatic',
          label: 'Automatic discovery',
          description: 'Check PATH, then mise.',
        },
        {
          value: 'custom',
          label: 'Custom executable',
          description: 'Use an absolute path.',
        },
      ],
      2,
      getSelectListTheme(),
      {minPrimaryColumnWidth: 22, maxPrimaryColumnWidth: 22},
    );
    this.choices.setSelectedIndex(current === undefined ? 0 : 1);
    this.choices.onCancel = () => {
      this.dispose();
      done();
    };
    this.choices.onSelect = item => {
      if (item.value === 'automatic') void this.submit(undefined);
      else {
        this.mode = 'input';
        this.input.focused = true;
        requestRender();
      }
    };
    this.input = new Input({
      prompt: '> ',
      placeholder: '/absolute/path/to/rtk',
      placeholderStyle: text => theme.fg('dim', text),
    });
    this.input.setValue(initialPath);
    this.input.onSubmit = value => {
      void this.submit(value);
    };
    this.input.onEscape = () => {
      this.dispose();
      this.mode = 'choice';
      this.input.focused = false;
      this.error = '';
      requestRender();
    };
  }

  private async submit(path: string | undefined) {
    if (this.pending) return;
    const pending = new AbortController();
    this.pending = pending;
    this.error = '';
    this.requestRender();
    try {
      if (path !== undefined)
        await new RtkRuntime({executable: path}).probe(
          this.cwd,
          pending.signal,
        );
      if (pending.signal.aborted) return;
      await this.save(path);
      if (!pending.signal.aborted)
        this.done(path === undefined ? 'automatic' : 'custom');
    } catch (error) {
      if (!pending.signal.aborted) {
        this.error = stripVTControlCharacters(String(error));
        this.notifyError(this.error);
      }
    } finally {
      if (this.pending === pending) this.pending = undefined;
      this.requestRender();
    }
  }

  handleInput(data: string) {
    if (matchesKey(data, Key.escape)) {
      this.dispose();
      if (this.mode === 'input') {
        this.mode = 'choice';
        this.input.focused = false;
        this.error = '';
      } else this.done();
    } else if (this.mode === 'input') this.input.handleInput(data);
    else this.choices.handleInput(data);
    this.requestRender();
  }
  render(width: number) {
    return [
      this.theme.bold('RTK executable'),
      '',
      ...(this.mode === 'input'
        ? ['Enter an absolute RTK path.', ...this.input.render(width)]
        : this.choices.render(width)),
      ...(this.pending
        ? [this.theme.fg('muted', 'Validating and saving...')]
        : []),
      ...wrapTextWithAnsi(this.error, width).slice(0, 3),
      '',
      this.theme.fg(
        'dim',
        this.mode === 'input'
          ? 'Enter Save · Esc Choices'
          : '↑↓ Navigate · Enter Select · Esc Back',
      ),
    ];
  }
  invalidate() {
    this.input.invalidate();
    this.choices.invalidate();
  }
  dispose() {
    this.pending?.abort();
  }
}
