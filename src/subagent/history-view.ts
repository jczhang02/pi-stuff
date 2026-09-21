import {
  getSelectListTheme,
  keyHint,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  SelectList,
  truncateToWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import type {FleetRow} from './fleet';
import type {RequestRecord} from './records';

export class HistoryView {
  private readonly records: RequestRecord[];
  private selection = 0;
  private list: SelectList | undefined;

  constructor(readonly row: FleetRow) {
    const current =
      row.run.tasks.find(task => task.id === row.task.id) ?? row.task;
    this.records = structuredClone([...current.history, current]);
  }

  selectedRecord(): RequestRecord | undefined {
    return this.records[this.selection];
  }

  handleInput(data: string): void {
    this.list?.handleInput(data);
  }

  render(width: number, height: number, theme: Theme): string[] {
    const help = wrapTextWithAnsi(
      theme.fg(
        'dim',
        `${keyHint('tui.select.up', '')}/${keyHint('tui.select.down', 'select')} · ${keyHint('tui.select.confirm', 'read')} · esc back`,
      ),
      width,
    );
    this.list = new SelectList(
      this.records.map(record => ({
        value: record.requestId,
        label: `${record.startedAt === undefined ? 'Not started' : new Date(record.startedAt).toLocaleString()} · ${record.task.replace(/[\r\n]/g, ' ')}`,
        description: record.status,
      })),
      Math.max(1, height - help.length - 2),
      getSelectListTheme(),
      {maxPrimaryColumnWidth: Math.max(20, width - 15)},
    );
    this.list.setSelectedIndex(this.selection);
    this.list.onSelectionChange = item => {
      this.selection = this.records.findIndex(
        record => record.requestId === item.value,
      );
    };
    return [
      truncateToWidth(
        theme.bold(`${this.row.task.agent} · Request history`),
        width,
        '…',
      ),
      ...this.list.render(width),
      ...help,
    ];
  }
}
