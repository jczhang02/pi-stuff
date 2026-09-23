import {
  DynamicBorder,
  getSelectListTheme,
  keyText,
  keyHint,
  rawKeyHint,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  SelectList,
  Container,
  Text,
  Spacer,
  type Component,
  visibleWidth,
  truncateToWidth,
  wrapTextWithAnsi,
  type SelectItem,
} from '@earendil-works/pi-tui';
import {readablePanelLines} from './panel-style';

// Shared composition only; native children retain their input and mouse behavior.
export class PanelPage extends Container {
  constructor(
    theme: Theme,
    title: string,
    private readonly body: Component,
    summary = '',
  ) {
    super();
    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg('accent', theme.bold(title)), 1, 0));
    this.addChild(new Spacer(1));
    if (summary) {
      this.addChild(new Text(summary, 1, 0));
      this.addChild(new Spacer(1));
    }
    this.addChild(body);
    if (body instanceof SelectList) {
      this.addChild(new Spacer(1));
      this.addChild(
        new Text(
          `${rawKeyHint(keyText('tui.select.up') === 'up' && keyText('tui.select.down') === 'down' ? '↑↓' : `${keyText('tui.select.up')}/${keyText('tui.select.down')}`, 'navigate')}  ${keyHint('tui.select.confirm', 'select')}  ${keyHint('tui.select.cancel', 'back')}`,
          1,
          0,
        ),
      );
    }
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
  }
  handleInput(data: string) {
    this.body.handleInput?.(data);
  }
}

export function navigationHint(
  action: 'Open' | 'Change' | 'Select',
  exit: 'Close' | 'Back',
) {
  const up = keyText('tui.select.up');
  const down = keyText('tui.select.down');
  const navigation = up === 'up' && down === 'down' ? '↑↓' : `${up}/${down}`;
  const confirm = keyText('tui.select.confirm');
  return `${navigation} Navigate · ${confirm === 'enter' ? 'Enter' : confirm} ${action} · Esc ${exit}`;
}

export function panelMenu(items: SelectItem[]) {
  return new SelectList(items, items.length, getSelectListTheme());
}

// Presentation only: feature owners retain navigation, requests and save lifetimes.
export class PanelLayout {
  private readonly border: DynamicBorder;
  constructor(private readonly theme: Theme) {
    this.border = new DynamicBorder(text => theme.fg('borderAccent', text));
  }
  frame(width: number, title: string, lines: string[], status = '') {
    const border = this.border.render(width)[0] ?? '';
    const heading = this.theme.bold(this.theme.fg('accent', title));
    const gap =
      width < 76
        ? 2
        : Math.max(2, width - 4 - visibleWidth(title) - visibleWidth(status));
    return readablePanelLines(
      [
        border,
        heading +
          (status ? ' '.repeat(gap) + this.theme.fg('muted', status) : ''),
        '',
        ...lines,
        border,
      ],
      this.theme,
    );
  }
  tooSmall(width: number, name: string, rows: number, exitHint = 'Esc Close') {
    return this.frame(width, name, [
      ...wrapTextWithAnsi(`${name} needs more room`, Math.max(1, width)),
      ...wrapTextWithAnsi(
        `Resize to at least 56 columns and ${rows} rows.`,
        Math.max(1, width),
      ),
      '',
      exitHint,
    ]);
  }
  editor(
    width: number,
    label: string,
    body: string[],
    feedback: string,
    hint: string,
  ) {
    return [
      this.theme.bold(label),
      '',
      ...body,
      truncateToWidth(feedback.replace(/\s+/gu, ' '), width),
      '',
      ...wrapTextWithAnsi(this.theme.fg('dim', hint), width),
    ];
  }
  invalidate() {
    this.border.invalidate();
  }
}
