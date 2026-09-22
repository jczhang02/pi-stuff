import {
  DynamicBorder,
  getSelectListTheme,
  getSettingsListTheme,
  keyText,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  SelectList,
  visibleWidth,
  truncateToWidth,
  wrapTextWithAnsi,
  type SelectItem,
  type SettingsList,
} from '@earendil-works/pi-tui';
import {readablePanelLines} from './panel-style';

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
  return new SelectList(items, items.length, getSelectListTheme(), {
    minPrimaryColumnWidth: 18,
    maxPrimaryColumnWidth: 18,
  });
}

export function panelSettingsTheme(theme: Theme) {
  return {
    ...getSettingsListTheme(),
    hint: () => theme.fg('dim', `  ${navigationHint('Change', 'Back')}`),
  };
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
  tooSmall(width: number, name: string, rows: number) {
    return this.frame(width, name, [
      ...wrapTextWithAnsi(`${name} needs more room`, Math.max(1, width)),
      ...wrapTextWithAnsi(
        `Resize to at least 56 columns and ${rows} rows.`,
        Math.max(1, width),
      ),
      '',
      'Esc Close',
    ]);
  }
  home(
    width: number,
    description: string,
    summary: string[],
    menu: SelectList,
  ) {
    return [
      ...wrapTextWithAnsi(description, width),
      '',
      ...summary,
      '',
      ...menu.render(width),
      '',
      this.theme.fg('dim', navigationHint('Open', 'Close')),
    ];
  }
  settings(
    width: number,
    list: SettingsList,
    descriptions: string[],
    error: string,
  ) {
    const lines = list.render(width);
    const body = lines.slice(0, -1);
    // Native SettingsList has one separator and one blank description row.
    const rows =
      descriptions.length +
      2 +
      Math.max(
        ...descriptions.map(text => wrapTextWithAnsi(text, width - 4).length),
      );
    return [
      this.theme.bold('Behavior'),
      ...body,
      ...Array<string>(Math.max(0, rows - body.length)).fill(''),
      truncateToWidth(
        this.theme.fg('error', error.replace(/\s+/gu, ' ')),
        width,
      ),
      lines.at(-1) ?? '',
    ];
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
