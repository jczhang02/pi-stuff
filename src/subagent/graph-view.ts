import type {Theme} from '@earendil-works/pi-coding-agent';
import {
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
  type KeybindingsManager,
} from '@earendil-works/pi-tui';
import type {RunSnapshot, TaskSnapshot} from './records';
import {compactTaskText, requestTime, requestTokens, taskState} from './fleet';

interface Node {
  task: TaskSnapshot;
  level: number;
  row: number;
}

function duplicateAgents(tasks: readonly TaskSnapshot[]): Set<string> {
  const counts = new Map<string, number>();
  for (const task of tasks)
    counts.set(task.agent, (counts.get(task.agent) ?? 0) + 1);
  return new Set(
    [...counts].filter(([, count]) => count > 1).map(([agent]) => agent),
  );
}

function nodesFor(tasks: readonly TaskSnapshot[]): Node[] {
  const remaining = new Set(tasks);
  const nodes = new Map<string, Node>();
  while (remaining.size) {
    const task = tasks.find(
      task => remaining.has(task) && task.needs.every(id => nodes.has(id)),
    );
    if (!task) throw new Error('Cannot display an invalid dependency graph.');
    nodes.set(task.id, {
      task,
      level: task.needs.length
        ? 1 + Math.max(...task.needs.map(id => nodes.get(id)?.level ?? 0))
        : 0,
      row: nodes.size * 2,
    });
    remaining.delete(task);
  }
  return [...nodes.values()];
}

// Direction bits N/E/S/W produce connected junctions without drawing a tree.
const junctions = [
  ' ',
  '╵',
  '╶',
  '└',
  '╷',
  '│',
  '┌',
  '├',
  '╴',
  '┘',
  '─',
  '┴',
  '┐',
  '┤',
  '┬',
  '╳',
];

export class GraphView {
  private selected: string;

  constructor(
    readonly run: RunSnapshot,
    selectedTaskId: string,
    private readonly queuedReason?: (taskId: string) => string | undefined,
  ) {
    this.selected = run.tasks.some(task => task.id === selectedTaskId)
      ? selectedTaskId
      : (run.tasks[0]?.id ?? '');
  }

  selectedTask(): TaskSnapshot | undefined {
    return this.run.tasks.find(task => task.id === this.selected);
  }

  handleInput(data: string, keys: KeybindingsManager): boolean {
    const nodes = nodesFor(this.run.tasks);
    const index = nodes.findIndex(node => node.task.id === this.selected);
    const movement = keys.matches(data, 'tui.select.up')
      ? -1
      : keys.matches(data, 'tui.select.down')
        ? 1
        : 0;
    if (!movement) return false;
    const next =
      nodes[Math.max(0, Math.min(nodes.length - 1, index + movement))];
    if (next) this.selected = next.task.id;
    return true;
  }

  render(width: number, height: number, theme: Pick<Theme, 'fg'>): string[] {
    if (width < 30 || height < 5) return ['Resize terminal.'];
    const nodes = nodesFor(this.run.tasks);
    const selected = nodes.find(node => node.task.id === this.selected);
    if (!selected) return ['No dependency graph.'];
    const nodeWidth = Math.min(28, Math.max(16, Math.floor(width / 3) - 5));
    const duplicateNames = duplicateAgents(this.run.tasks);
    const labels = new Map(
      nodes.map(node => {
        const name = duplicateNames.has(node.task.agent)
          ? `${truncateToWidth(node.task.agent, Math.floor((nodeWidth - 5) / 2), '…')} · ${compactTaskText(node.task.task)}`
          : node.task.agent;
        return [
          node.task.id,
          truncateToWidth(
            `${node.task.id === this.selected ? '●' : '○'} ${name}`,
            nodeWidth,
            '…',
          ),
        ];
      }),
    );
    const layerColumns = [0];
    const rails = new Map<string, number>();
    for (
      let level = 1;
      level <= Math.max(...nodes.map(node => node.level));
      level++
    ) {
      const targets = nodes.filter(node => node.level === level);
      const column =
        (layerColumns[level - 1] ?? 0) + nodeWidth + targets.length * 2 + 3;
      layerColumns.push(column);
      targets.forEach((target, index) =>
        rails.set(target.task.id, column - 3 - index * 2),
      );
    }
    const fullWidth = (layerColumns.at(-1) ?? 0) + nodeWidth;
    const bodyHeight = height - 2;
    const top = Math.max(
      0,
      Math.min(
        selected.row - Math.floor(bodyHeight / 2),
        nodes.length * 2 - 1 - bodyHeight,
      ),
    );
    const left = Math.max(
      0,
      Math.min(
        (layerColumns[selected.level] ?? 0) +
          Math.floor(nodeWidth / 2) -
          Math.floor(width / 2),
        fullWidth - width,
      ),
    );
    const cells = Array.from({length: bodyHeight}, () =>
      Array<number>(width).fill(0),
    );
    const arrows = new Map<string, string>();
    const connections = new Set<string>();
    const paint = (x: number, y: number, bits: number) => {
      const row = cells[y - top];
      const column = x - left;
      if (row && column >= 0 && column < width)
        row[column] = (row[column] ?? 0) | bits;
    };
    const horizontal = (start: number, end: number, y: number) => {
      for (
        let x = Math.max(start, left);
        x <= Math.min(end, left + width - 1);
        x++
      )
        paint(x, y, 10);
      if (y >= top && y < top + bodyHeight) {
        if (start < left && end >= left) arrows.set(`${y - top}:0`, '←');
        if (end >= left + width && start < left + width)
          arrows.set(`${y - top}:${width - 1}`, '→');
      }
    };
    const byId = new Map(nodes.map(node => [node.task.id, node]));
    for (const target of nodes) {
      for (const id of target.task.needs) {
        const source = byId.get(id);
        if (!source) continue;
        const start =
          (layerColumns[source.level] ?? 0) +
          visibleWidth(labels.get(source.task.id) ?? '') +
          1;
        const end = layerColumns[target.level] ?? 0;
        const rail = rails.get(target.task.id) ?? end - 3;
        connections.add(`${source.row - top}:${rail - left}`);
        horizontal(start, rail - 1, source.row);
        if (
          start - 1 <= left &&
          rail >= left &&
          source.row >= top &&
          source.row < top + bodyHeight
        )
          arrows.set(`${source.row - top}:0`, '←');
        paint(rail, source.row, 12);
        for (
          let y = Math.max(source.row + 1, top);
          y < Math.min(target.row, top + bodyHeight);
          y++
        )
          paint(rail, y, 5);
        paint(rail, target.row, 3);
        horizontal(rail + 1, end - 1, target.row);
        if (
          end - 1 >= left &&
          end - 1 < left + width &&
          target.row >= top &&
          target.row < top + bodyHeight
        )
          arrows.set(`${target.row - top}:${end - 1 - left}`, '▶');
        if (rail >= left && rail < left + width) {
          if (source.row < top && target.row >= top)
            arrows.set(`0:${rail - left}`, '↑');
          if (source.row < top + bodyHeight && target.row >= top + bodyHeight)
            arrows.set(`${bodyHeight - 1}:${rail - left}`, '↓');
        }
      }
    }
    const lines = cells.map((row, y) =>
      row
        .map(
          (bits, x) =>
            arrows.get(`${y}:${x}`) ??
            (bits === 15 && connections.has(`${y}:${x}`)
              ? '┼'
              : junctions[bits]) ??
            ' ',
        )
        .join(''),
    );
    for (const node of nodes) {
      const y = node.row - top;
      if (y < 0 || y >= bodyHeight) continue;
      const x = layerColumns[node.level] ?? 0;
      const label = labels.get(node.task.id) ?? '';
      const labelWidth = visibleWidth(label);
      const clipStart = Math.max(0, left - x);
      const clipWidth = Math.min(
        labelWidth - clipStart,
        width - Math.max(0, x - left),
      );
      if (clipWidth <= 0) continue;
      const column = Math.max(0, x - left);
      const line = lines[y] ?? '';
      const clipped = sliceByColumn(label, clipStart, clipWidth, true);
      lines[y] =
        line.slice(0, column) +
        clipped +
        ' '.repeat(Math.max(0, clipWidth - visibleWidth(clipped))) +
        line.slice(column + clipWidth);
      if (clipStart > 0)
        lines[y] = '←' + sliceByColumn(lines[y] ?? '', 1, width - 1, true);
      if (x + labelWidth > left + width)
        lines[y] = sliceByColumn(lines[y] ?? '', 0, width - 1, true) + '→';
    }
    const state = taskState(selected.task, this.run.tasks) || 'Working';
    const pending = selected.task.needs
      .map(id => this.run.tasks.find(task => task.id === id))
      .filter(task => task && (task.status !== 'completed' || task.finalizing));
    const reason =
      this.queuedReason?.(selected.task.id) ??
      (selected.task.status === 'queued' && pending.length
        ? `Waiting for ${pending.map(task => task?.agent).join(', ')}`
        : state);
    const assignment = compactTaskText(selected.task.task);
    const identity = `${reason} · ${selected.task.agent} · ${assignment}`;
    const metrics = `${requestTime(selected.task, Date.now())} · ${requestTokens(selected.task)}`;
    const detail =
      visibleWidth(reason) + visibleWidth(metrics) + 3 <= width
        ? `${truncateToWidth(identity, width - visibleWidth(metrics) - 3, '…')} · ${metrics}`
        : identity;
    return [
      theme.fg(
        'accent',
        truncateToWidth(
          `Dependencies · ${nodes.findIndex(node => node === selected) + 1}/${nodes.length}${cells.some((row, y) => row.some((bits, x) => bits === 15 && !connections.has(`${y}:${x}`))) ? ' · ╳ crossing' : ''}`,
          width,
          '…',
        ),
      ),
      ...lines.map(line => theme.fg('text', line)),
      theme.fg('muted', truncateToWidth(detail, width, '…')),
    ];
  }
}
