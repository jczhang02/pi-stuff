import {truncateToWidth, visibleWidth} from '@earendil-works/pi-tui';
import {stripVTControlCharacters} from 'node:util';
import type {Theme} from '@earendil-works/pi-coding-agent';
import type {FleetRecord} from '../records';
import {oneLine} from './format';
import {graphEdges} from './navigation';
import type {OverviewModel} from './types';

export interface DependencyGraphState {
  readonly snapshot: FleetRecord;
  readonly selectedTaskId: string | undefined;
  readonly graphPan: number;
}

export interface DependencyGraphPoint {
  readonly x: number;
  readonly y: number;
}

export interface DependencyGraphNodeBounds {
  readonly id: string;
  readonly level: number;
  readonly lane: number;
  readonly x: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly centerY: number;
  readonly width: number;
}

export interface DependencyGraphEdgeRoute {
  readonly from: string;
  readonly to: string;
  readonly points: readonly DependencyGraphPoint[];
  readonly detoured: boolean;
}

export interface DependencyGraphGeometry {
  readonly nodeWidth: number;
  readonly columnGap: number;
  readonly height: number;
  readonly minX: number;
  readonly maxX: number;
  readonly nodes: readonly DependencyGraphNodeBounds[];
  readonly edges: readonly DependencyGraphEdgeRoute[];
}

/**
 * Return route indices that are allowed to join at each physical point.
 *
 * A shared endpoint is not enough to make a perpendicular crossing a join:
 * routes with the same target must share the complete suffix after the join,
 * and routes with the same source must share the complete prefix before the
 * fork. The renderer uses this map to keep every other crossing bridged.
 */
function dependencyGraphJunctionOwners(
  routes: readonly DependencyGraphEdgeRoute[],
): ReadonlyMap<string, ReadonlySet<number>> {
  const paths = routes.map(expandRoutePath);
  const owners = new Map<string, Set<number>>();
  for (let left = 0; left < routes.length; left++)
    for (let right = left + 1; right < routes.length; right++) {
      const first = routes[left]!;
      const second = routes[right]!;
      if (first.to === second.to)
        addSharedPathOwners(
          owners,
          paths[left]!,
          paths[right]!,
          left,
          right,
          false,
        );
      if (first.from === second.from)
        addSharedPathOwners(
          owners,
          paths[left]!,
          paths[right]!,
          left,
          right,
          true,
        );
    }
  return owners;
}

function expandRoutePath(
  route: DependencyGraphEdgeRoute,
): readonly DependencyGraphPoint[] {
  const path: DependencyGraphPoint[] = [];
  for (let index = 1; index < route.points.length; index++) {
    const start = route.points[index - 1]!;
    const end = route.points[index]!;
    const dx = Math.sign(end.x - start.x);
    const dy = Math.sign(end.y - start.y);
    const length = Math.max(
      Math.abs(end.x - start.x),
      Math.abs(end.y - start.y),
    );
    if (dx !== 0 && dy !== 0) continue;
    if (path.length === 0) path.push(start);
    for (let offset = 1; offset <= length; offset++)
      path.push({x: start.x + dx * offset, y: start.y + dy * offset});
  }
  return path;
}

function addSharedPathOwners(
  owners: Map<string, Set<number>>,
  first: readonly DependencyGraphPoint[],
  second: readonly DependencyGraphPoint[],
  firstIndex: number,
  secondIndex: number,
  prefix: boolean,
): void {
  const limit = Math.min(first.length, second.length);
  for (let offset = 0; offset < limit; offset++) {
    const firstPoint = prefix
      ? first[offset]
      : first[first.length - 1 - offset];
    const secondPoint = prefix
      ? second[offset]
      : second[second.length - 1 - offset];
    if (
      firstPoint === undefined ||
      secondPoint === undefined ||
      firstPoint.x !== secondPoint.x ||
      firstPoint.y !== secondPoint.y
    )
      break;
    const key = pointKey(firstPoint);
    const pointOwners = owners.get(key);
    if (pointOwners === undefined)
      owners.set(key, new Set([firstIndex, secondIndex]));
    else {
      pointOwners.add(firstIndex);
      pointOwners.add(secondIndex);
    }
  }
}

function pointKey(point: DependencyGraphPoint): string {
  return `${point.x},${point.y}`;
}

type GraphStyle = 'plain' | 'edge' | 'node' | 'selected' | 'reference';

interface GraphCell {
  text: string;
  style: GraphStyle;
  mask: number;
  horizontalOwners: readonly number[];
  verticalOwners: readonly number[];
  crossing: boolean;
  crossingDirection: 'horizontal' | 'vertical' | undefined;
}

interface GraphNodePosition {
  readonly node: OverviewModel['nodes'][number];
  readonly label: string;
  readonly bounds: DependencyGraphNodeBounds;
}

const LEFT = 1;
const RIGHT = 2;
const UP = 4;
const DOWN = 8;

const NODE_HEIGHT = 3;
const NODE_TOP = 2;
const LANE_STEP = 4;

/**
 * Calculate stable node bounds and obstacle-free orthogonal edge routes.
 *
 * The returned coordinates are content coordinates before the overview's
 * outer line limit is applied. Consumers can use node bounds to bring a
 * selected node into the horizontal graph viewport without duplicating the
 * layout rules used by the renderer.
 */
export function computeDependencyGraphGeometry(
  model: OverviewModel,
  width: number,
  graphPan = 0,
): DependencyGraphGeometry {
  const nodeWidth = width >= 150 ? 26 : width >= 110 ? 22 : 16;
  const edges = graphEdges(model);
  const baseColumnGap = width >= 110 ? 6 : 4;
  const nodesById = new Map(model.nodes.map(node => [node.id, node]));
  const sameLevelSources = new Set(
    edges
      .filter(edge => {
        const source = nodesById.get(edge.from);
        const target = nodesById.get(edge.to);
        return (
          source !== undefined &&
          target !== undefined &&
          target.level <= source.level
        );
      })
      .map(edge => edge.from),
  );
  const columnFor = (id: string): number => {
    const node = nodesById.get(id);
    return node?.reference && sameLevelSources.has(id)
      ? node.level - 1
      : (node?.level ?? 0);
  };
  // A gap containing only one adjacent fan-in or fan-out needs a single
  // branch, not the separate crossing tracks used by mixed dependencies.
  const simpleGaps = new Set<number>();
  for (const column of new Set(edges.map(edge => columnFor(edge.from)))) {
    const incident = edges.filter(
      edge =>
        columnFor(edge.from) === column || columnFor(edge.to) - 1 === column,
    );
    if (
      incident.every(edge => columnFor(edge.to) === columnFor(edge.from) + 1) &&
      (incident.every(edge => edge.from === incident[0]?.from) ||
        incident.every(edge => edge.to === incident[0]?.to))
    )
      simpleGaps.add(column);
  }
  const sourceSlots = new Map<number, number>();
  const targetSlots = new Map<number, number>();
  const slots = edges.map(edge => {
    const sourceColumn = columnFor(edge.from);
    const targetColumn = columnFor(edge.to) - 1;
    const source = sourceSlots.get(sourceColumn) ?? 0;
    const target = targetSlots.get(targetColumn) ?? 0;
    sourceSlots.set(sourceColumn, source + 1);
    targetSlots.set(targetColumn, target + 1);
    return {source, target};
  });
  // Outgoing tracks occupy the left half of a gap; incoming tracks occupy
  // the right half. Each edge has its own vertical track in either family.
  const trackCount = Math.max(
    0,
    ...sourceSlots.values(),
    ...targetSlots.values(),
  );
  const columnGap = Math.max(baseColumnGap, trackCount * 2 + 4);
  const step = nodeWidth + columnGap;
  const lanes = new Map<number, number>();
  const nodes: DependencyGraphNodeBounds[] = [];
  for (const node of model.nodes) {
    const lane = lanes.get(node.level) ?? 0;
    lanes.set(node.level, lane + 1);
    const column =
      node.reference && sameLevelSources.has(node.id)
        ? node.level - 1
        : node.level;
    const x = 2 + column * step - graphPan;
    const top = NODE_TOP + lane * LANE_STEP;
    nodes.push({
      id: node.id,
      level: node.level,
      lane,
      x,
      right: x + nodeWidth - 1,
      top,
      bottom: top + NODE_HEIGHT - 1,
      centerY: top + 1,
      width: nodeWidth,
    });
  }
  const boundsById = new Map(nodes.map(node => [node.id, node]));
  const maxBottom = Math.max(3, ...nodes.map(node => node.bottom));
  const maxLane = Math.max(0, ...nodes.map(node => node.lane));
  const routes: DependencyGraphEdgeRoute[] = [];
  let detourIndex = 0;
  for (const [index, edge] of edges.entries()) {
    const source = boundsById.get(edge.from);
    const target = boundsById.get(edge.to);
    if (source === undefined || target === undefined) {
      routes.push({
        from: edge.from,
        to: edge.to,
        points: [],
        detoured: false,
      });
      continue;
    }
    const sourcePort = {
      x: source.right + 1,
      y: source.centerY,
    } satisfies DependencyGraphPoint;
    const targetPort = {
      x: target.x - 1,
      y: target.centerY,
    } satisfies DependencyGraphPoint;
    const straight =
      target.x - source.x === step && source.centerY === target.centerY;
    const slot = slots[index]!;
    // Horizontal detours use unique rows between node bands, then below the
    // graph. They can cross vertical tracks, but never share a segment.
    const trackY =
      detourIndex <= maxLane + 1
        ? NODE_TOP - 1 + detourIndex * LANE_STEP
        : maxBottom + 3 + (detourIndex - maxLane - 2) * 2;
    const sourceX = source.right + 2 + slot.source;
    const targetX = target.x - 2 - slot.target;
    const branchX = source.right + Math.floor(columnGap / 2);
    const simple = simpleGaps.has(columnFor(edge.from));
    const points = straight
      ? [sourcePort, targetPort]
      : simple
        ? compactPoints([
            sourcePort,
            {x: branchX, y: sourcePort.y},
            {x: branchX, y: targetPort.y},
            targetPort,
          ])
        : compactPoints([
            sourcePort,
            {x: sourceX, y: sourcePort.y},
            {x: sourceX, y: trackY},
            {x: targetX, y: trackY},
            {x: targetX, y: targetPort.y},
            targetPort,
          ]);
    if (!straight && !simple) detourIndex++;
    routes.push({from: edge.from, to: edge.to, points, detoured: !straight});
  }

  const maxRouteY = Math.max(
    maxBottom,
    ...routes.flatMap(route => route.points.map(point => point.y)),
  );
  const minX = Math.min(
    0,
    ...nodes.map(node => node.x),
    ...routes.flatMap(route => route.points.map(point => point.x)),
  );
  const maxX = Math.max(
    width,
    ...nodes.map(node => node.right + 1),
    ...routes.flatMap(route => route.points.map(point => point.x)),
  );
  return {
    nodeWidth,
    columnGap,
    height: Math.max(4, maxRouteY + 1),
    minX,
    maxX,
    nodes,
    edges: routes,
  };
}

function compactPoints(
  points: readonly DependencyGraphPoint[],
): readonly DependencyGraphPoint[] {
  const compact: DependencyGraphPoint[] = [];
  for (const point of points) {
    const previous = compact.at(-1);
    if (previous?.x === point.x && previous.y === point.y) continue;
    if (compact.length >= 2) {
      const before = compact.at(-2)!;
      if (
        (before.x === previous?.x && previous?.x === point.x) ||
        (before.y === previous?.y && previous?.y === point.y)
      )
        compact.pop();
    }
    compact.push(point);
  }
  return compact;
}

/** Render one dependency model as a stable left-to-right node canvas. */
export function renderDependencyGraph(
  state: DependencyGraphState,
  model: OverviewModel,
  width: number,
  theme: Theme,
): readonly string[] {
  const geometry = computeDependencyGraphGeometry(model, width, state.graphPan);
  const boundsById = new Map(geometry.nodes.map(node => [node.id, node]));
  const positions = new Map<string, GraphNodePosition>();
  for (const node of model.nodes) {
    const bounds = boundsById.get(node.id);
    if (bounds === undefined) continue;
    const taskAgent = node.task
      ? state.snapshot.agents.find(agent => agent.id === node.task?.agentId)
      : undefined;
    positions.set(node.id, {
      node,
      label: node.reference
        ? oneLine(node.label)
        : `${oneLine(taskAgent?.name ?? 'agent')} · ${oneLine(node.label)}`,
      bounds,
    });
  }
  const levels = [...new Set(model.nodes.map(node => node.level))].toSorted(
    (left, right) => left - right,
  );
  const canvas = new GraphCanvas(
    width,
    geometry.height,
    state.selectedTaskId,
    dependencyGraphJunctionOwners(geometry.edges),
  );
  for (const level of levels) {
    const first = [...positions.values()].find(
      position => position.node.level === level,
    );
    if (first !== undefined)
      canvas.text(first.bounds.x, 0, `L${level}`, 'plain');
  }
  for (const [index, edge] of geometry.edges.entries())
    canvas.edge(edge, index);
  for (const position of positions.values())
    canvas.node(position, geometry.nodeWidth);
  const output = [...canvas.render(theme)];
  const clipped = [
    geometry.minX < 0 ? 'left edge clipped' : undefined,
    geometry.maxX > width ? 'right edge clipped' : undefined,
  ].filter((item): item is string => item !== undefined);
  output.push(
    theme.fg(
      'dim',
      `Edges ${geometry.edges.length} · left-to-right · h/l pan${clipped.length > 0 ? ` · ${clipped.join(' · ')}` : ' · full width'}`,
    ),
  );
  return output;
}

class GraphCanvas {
  private readonly rows: GraphCell[][];
  private readonly arrowTargets: DependencyGraphPoint[] = [];

  constructor(
    private readonly width: number,
    height: number,
    private readonly selectedId: string | undefined,
    private readonly junctionOwners: ReadonlyMap<string, ReadonlySet<number>>,
  ) {
    this.rows = Array.from({length: height}, () =>
      Array.from({length: width}, () => ({
        text: ' ',
        style: 'plain' as const,
        mask: 0,
        horizontalOwners: [],
        verticalOwners: [],
        crossing: false,
        crossingDirection: undefined,
      })),
    );
  }

  text(x: number, y: number, text: string, style: GraphStyle): void {
    if (y < 0 || y >= this.rows.length) return;
    let column = x;
    for (const character of Array.from(text)) {
      const characterWidth = Math.max(1, visibleWidth(character));
      if (column >= 0 && column < this.width) {
        this.rows[y]![column] = {
          text: character,
          style,
          mask: 0,
          horizontalOwners: [],
          verticalOwners: [],
          crossing: false,
          crossingDirection: undefined,
        };
        for (let offset = 1; offset < characterWidth; offset++) {
          if (column + offset >= 0 && column + offset < this.width)
            this.rows[y]![column + offset] = {
              text: '',
              style,
              mask: 0,
              horizontalOwners: [],
              verticalOwners: [],
              crossing: false,
              crossingDirection: undefined,
            };
        }
      }
      column += characterWidth;
    }
  }

  node(position: GraphNodePosition, nodeWidth: number): void {
    const style: GraphStyle = position.node.reference ? 'reference' : 'node';
    const selectedStyle: GraphStyle =
      position.node.id === this.selectedId ? 'selected' : style;
    const horizontal = '─'.repeat(Math.max(2, nodeWidth - 2));
    this.text(
      position.bounds.x,
      position.bounds.top,
      `┌${horizontal}┐`,
      selectedStyle,
    );
    const label = stripVTControlCharacters(
      truncateToWidth(position.label, nodeWidth - 4, '…'),
    );
    const padded = `${label}${' '.repeat(
      Math.max(0, nodeWidth - 4 - visibleWidth(label)),
    )}`;
    this.text(
      position.bounds.x,
      position.bounds.top + 1,
      `│${position.node.id === this.selectedId ? '●' : '○'} ${padded}│`,
      selectedStyle,
    );
    this.text(
      position.bounds.x,
      position.bounds.top + 2,
      `└${horizontal}┘`,
      selectedStyle,
    );
  }

  edge(route: DependencyGraphEdgeRoute, routeIndex: number): void {
    for (let index = 1; index < route.points.length; index++) {
      const start = route.points[index - 1]!;
      const end = route.points[index]!;
      if (start.y === end.y)
        this.horizontal(start.x, end.x, start.y, routeIndex);
      else if (start.x === end.x)
        this.vertical(start.x, start.y, end.y, routeIndex);
    }
    const target = route.points.at(-1);
    if (target !== undefined) this.arrowTargets.push(target);
  }

  render(theme: Theme): readonly string[] {
    for (const target of this.arrowTargets)
      this.text(target.x, target.y, '▶', 'edge');
    return this.rows.map(row => {
      let result = '';
      let index = 0;
      while (index < row.length) {
        const cell = row[index]!;
        if (cell.text === '') {
          index++;
          continue;
        }
        let end = index + 1;
        while (
          end < row.length &&
          row[end]!.style === cell.style &&
          row[end]!.text !== ''
        )
          end++;
        const text = row
          .slice(index, end)
          .map(item => item.text)
          .join('');
        result += styleGraphText(theme, cell.style, text);
        index = end;
      }
      return result.trimEnd();
    });
  }

  private horizontal(
    x1: number,
    x2: number,
    y: number,
    routeIndex: number,
  ): void {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
      this.connector(
        x,
        y,
        (x > Math.min(x1, x2) ? LEFT : 0) | (x < Math.max(x1, x2) ? RIGHT : 0),
        routeIndex,
      );
  }

  private vertical(
    x: number,
    y1: number,
    y2: number,
    routeIndex: number,
  ): void {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
      this.connector(
        x,
        y,
        (y > Math.min(y1, y2) ? UP : 0) | (y < Math.max(y1, y2) ? DOWN : 0),
        routeIndex,
      );
  }

  private connector(
    x: number,
    y: number,
    mask: number,
    routeIndex: number,
  ): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.rows.length) return;
    const cell = this.rows[y]![x]!;
    if (cell.style !== 'plain' && cell.style !== 'edge') return;
    const merged = cell.mask | mask;
    const horizontal = (mask & (LEFT | RIGHT)) !== 0;
    const perpendicularOwners = horizontal
      ? cell.verticalOwners
      : cell.horizontalOwners;
    const pointOwners = this.junctionOwners.get(pointKey({x, y}));
    const joinsAtJunction =
      pointOwners?.has(routeIndex) === true &&
      perpendicularOwners.some(owner => pointOwners.has(owner));
    const crossesRoute =
      perpendicularOwners.some(owner => owner !== routeIndex) &&
      !joinsAtJunction;
    const crossing = cell.crossing || crossesRoute;
    const crossingDirection =
      cell.crossingDirection ??
      (crossesRoute ? (horizontal ? 'horizontal' : 'vertical') : undefined);
    const horizontalOwners = horizontal
      ? cell.horizontalOwners.includes(routeIndex)
        ? cell.horizontalOwners
        : [...cell.horizontalOwners, routeIndex]
      : cell.horizontalOwners;
    const verticalOwners = horizontal
      ? cell.verticalOwners
      : cell.verticalOwners.includes(routeIndex)
        ? cell.verticalOwners
        : [...cell.verticalOwners, routeIndex];
    this.rows[y]![x] = {
      text:
        crossing && crossingDirection !== undefined
          ? crossingCharacter(crossingDirection)
          : connectorCharacter(merged),
      style: 'edge',
      mask: merged,
      horizontalOwners,
      verticalOwners,
      crossing,
      crossingDirection,
    };
  }
}

function styleGraphText(theme: Theme, style: GraphStyle, text: string): string {
  if (style === 'edge' || style === 'selected') return theme.fg('accent', text);
  if (style === 'reference') return theme.fg('warning', text);
  if (style === 'node') return theme.fg('text', text);
  return theme.fg('dim', text);
}

function connectorCharacter(mask: number): string {
  switch (mask) {
    case LEFT | RIGHT:
      return '─';
    case UP | DOWN:
      return '│';
    case RIGHT | DOWN:
      return '┌';
    case LEFT | DOWN:
      return '┐';
    case RIGHT | UP:
      return '└';
    case LEFT | UP:
      return '┘';
    case LEFT | RIGHT | DOWN:
      return '┬';
    case LEFT | RIGHT | UP:
      return '┴';
    case UP | DOWN | RIGHT:
      return '├';
    case UP | DOWN | LEFT:
      return '┤';
    case LEFT | RIGHT | UP | DOWN:
      return '┼';
    default:
      return mask & (LEFT | RIGHT) ? '─' : '│';
  }
}

function crossingCharacter(direction: 'horizontal' | 'vertical'): string {
  return direction === 'horizontal' ? '╪' : '╫';
}
