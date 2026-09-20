import {expect, test} from 'bun:test';
import {stripVTControlCharacters} from 'node:util';
import type {TaskRecord} from '../../src/subagent/records';
import {
  computeDependencyGraphGeometry,
  type DependencyGraphEdgeRoute,
} from '../../src/subagent/ui/graph';
import type {GraphNode, OverviewModel} from '../../src/subagent/ui/types';
import {overviewModels} from '../../src/subagent/ui/navigation';
import {
  launchPi,
  type FixtureReply,
  type ModelRequest,
} from './fixtures/pi-terminal';

const configuration: TaskRecord['configuration'] = {
  model: 'fixture',
  thinking: 'medium',
  tools: [],
  ceiling: [],
  cwd: '.',
  workspace: 'live',
  instructions: '',
  role: null,
  copyHistory: false,
  executionTimeoutMs: null,
  extensions: [],
  baseline: null,
  include: [],
};

function graphTask(
  id: string,
  needs: readonly string[],
  admittedAt: number,
): TaskRecord {
  return {
    id,
    agentId: `agent-${id}`,
    dispatchId: 'dispatch',
    parentTaskId: null,
    prompt: id,
    description: id,
    needs: [...needs],
    admittedAt,
    startedAt: admittedAt,
    endedAt: admittedAt + 1,
    phase: 'ended',
    outcome: 'fulfilled',
    declaration: 'fulfilled',
    stopOutcome: null,
    durability: 'saved',
    acceptance: true,
    reason: '',
    stage: 'settled',
    liveText: '',
    activeTools: [],
    report: id,
    files: [],
    checks: [],
    configuration,
    currentTools: [],
    usage: null,
    turns: 1,
    retries: 0,
    executionMs: 1,
    lastEventAt: admittedAt + 1,
    sessionFile: null,
    historyFile: null,
    workspaceDirectory: null,
    baseline: null,
    commit: null,
    baselineRequest: null,
    diff: '',
    artifactError: null,
    unsavedFiles: [],
    ignoredFiles: [],
    events: [],
    consumedChildren: [],
  };
}

function graphModel(
  tasks: readonly TaskRecord[],
  levels: readonly number[],
): OverviewModel {
  const nodes: GraphNode[] = tasks.map((task, index) => ({
    id: task.id,
    task,
    reference: false,
    label: task.description,
    level: levels[index] ?? 0,
  }));
  return {
    dispatchId: 'dispatch',
    title: 'Dispatch',
    taskIds: tasks.map(task => task.id),
    hasDependencies: tasks.some(task => task.needs.length > 0),
    nodes,
  };
}

function routeTouchesNode(
  route: DependencyGraphEdgeRoute,
  node: {
    readonly x: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  },
): boolean {
  for (let index = 1; index < route.points.length; index++) {
    const start = route.points[index - 1]!;
    const end = route.points[index]!;
    if (start.y === end.y) {
      if (
        start.y >= node.top &&
        start.y <= node.bottom &&
        Math.max(start.x, end.x) >= node.x &&
        Math.min(start.x, end.x) <= node.right
      )
        return true;
    } else if (
      start.x >= node.x &&
      start.x <= node.right &&
      Math.max(start.y, end.y) >= node.top &&
      Math.min(start.y, end.y) <= node.bottom
    )
      return true;
  }
  return false;
}

function routeTrackY(route: DependencyGraphEdgeRoute): number {
  const sourceY = route.points[0]?.y;
  const targetY = route.points.at(-1)?.y;
  if (sourceY === undefined || targetY === undefined)
    throw new Error('Graph route has no endpoints.');
  for (let index = 1; index < route.points.length; index++) {
    const start = route.points[index - 1]!;
    const end = route.points[index]!;
    if (start.y === end.y && start.y !== sourceY && start.y !== targetY)
      return start.y;
  }
  throw new Error('Graph route has no detour track.');
}

function routeSegmentKeys(
  route: DependencyGraphEdgeRoute,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (let index = 1; index < route.points.length; index++) {
    const start = route.points[index - 1]!;
    const end = route.points[index]!;
    const dx = Math.sign(end.x - start.x);
    const dy = Math.sign(end.y - start.y);
    const length = Math.max(
      Math.abs(end.x - start.x),
      Math.abs(end.y - start.y),
    );
    for (let offset = 0; offset < length; offset++) {
      const x = start.x + dx * offset;
      const y = start.y + dy * offset;
      keys.add(
        dx === 0
          ? `v:${x}:${Math.min(y, y + dy)}`
          : `h:${y}:${Math.min(x, x + dx)}`,
      );
    }
  }
  return keys;
}

function expectNoNonSharedSegmentOverlap(
  edges: readonly DependencyGraphEdgeRoute[],
): void {
  const segments = edges.map(routeSegmentKeys);
  for (let left = 0; left < edges.length; left++)
    for (let right = left + 1; right < edges.length; right++) {
      const first = edges[left]!;
      const second = edges[right]!;
      if (first.from === second.from || first.to === second.to) continue;
      const overlap = [...segments[left]!].some(key =>
        segments[right]!.has(key),
      );
      expect(overlap).toBe(false);
    }
}

function graphChildModel(
  marker: string,
): (request: ModelRequest) => FixtureReply | undefined {
  return request => {
    const history = JSON.stringify(request.messages);
    if (!history.includes('SUBAGENT_ASSIGNMENT') || !history.includes(marker))
      return undefined;
    if (request.messages.at(-1)?.role === 'tool') return {text: 'Delivered.'};
    return {
      tool: 'subagent',
      arguments: JSON.stringify({
        command: 'finish',
        outcome: 'fulfilled',
        text: 'Graph assignment settled.',
      }),
    };
  };
}

async function waitForSettled(
  host: Awaited<ReturnType<typeof launchPi>>,
  attempts: number,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await host.invoke(
      'subagent',
      '{"command":"wait","timeoutMs":5000}',
    );
    if (result.includes('"waitStatus":"settled"')) return;
  }
  throw new Error('Graph fixture did not settle within the test budget.');
}

test('graph geometry routes a mixed crossing around nodes and stays deterministic', () => {
  const tasks = [
    graphTask('A', [], 0),
    graphTask('X', [], 1),
    graphTask('B', ['X'], 2),
    graphTask('C', ['A', 'B'], 3),
  ];
  const model = graphModel(tasks, [0, 0, 1, 2]);
  const geometry = computeDependencyGraphGeometry(model, 100, 0);
  const repeated = computeDependencyGraphGeometry(model, 100, 0);

  expect(geometry).toEqual(repeated);
  expect(geometry.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual([
    'X->B',
    'A->C',
    'B->C',
  ]);
  const middle = geometry.nodes.find(node => node.id === 'B');
  const longEdge = geometry.edges.find(
    edge => edge.from === 'A' && edge.to === 'C',
  );
  if (middle === undefined || longEdge === undefined)
    throw new Error('Expected mixed graph nodes and edge are missing.');
  expect(longEdge.detoured).toBe(true);
  expect(routeTouchesNode(longEdge, middle)).toBe(false);
  expect(
    longEdge.points.some(
      point => point.y < middle.top || point.y > middle.bottom,
    ),
  ).toBe(true);
  for (const edge of geometry.edges)
    for (let index = 1; index < edge.points.length; index++) {
      const start = edge.points[index - 1]!;
      const end = edge.points[index]!;
      expect(start.x === end.x || start.y === end.y).toBe(true);
    }
});

test('adjacent crossing edges avoid shared collinear tracks', () => {
  const tasks = [
    graphTask('A', [], 0),
    graphTask('X', [], 1),
    graphTask('B', ['X'], 2),
    graphTask('Y', ['A'], 3),
  ];
  const geometry = computeDependencyGraphGeometry(
    graphModel(tasks, [0, 0, 1, 1]),
    90,
    0,
  );

  expect(geometry.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual([
    'X->B',
    'A->Y',
  ]);
  expectNoNonSharedSegmentOverlap(geometry.edges);
  expect(geometry.edges.some(edge => edge.detoured)).toBe(true);
  for (const edge of geometry.edges)
    for (const node of geometry.nodes) {
      if (node.id === edge.from || node.id === edge.to) continue;
      expect(routeTouchesNode(edge, node)).toBe(false);
    }
});

test('crossing long edges keep separate tracks and bend channels', () => {
  const tasks = [
    graphTask('A', [], 0),
    graphTask('X', [], 1),
    graphTask('B', ['A'], 2),
    graphTask('Y', ['X'], 3),
    graphTask('C', ['X', 'B'], 4),
    graphTask('D', ['A', 'Y'], 5),
  ];
  const model = graphModel(tasks, [0, 0, 1, 1, 2, 2]);
  const geometry = computeDependencyGraphGeometry(model, 90, 0);
  const route = (from: string, to: string): DependencyGraphEdgeRoute => {
    const found = geometry.edges.find(
      edge => edge.from === from && edge.to === to,
    );
    if (found === undefined) throw new Error(`Missing edge ${from}->${to}.`);
    return found;
  };
  const xToC = route('X', 'C');
  const aToD = route('A', 'D');
  expect(xToC.detoured).toBe(true);
  expect(aToD.detoured).toBe(true);
  expect(routeTrackY(xToC)).not.toBe(routeTrackY(aToD));
  const expectedEdges = ['A->B', 'X->Y', 'X->C', 'B->C', 'A->D', 'Y->D'];
  expect(geometry.edges.map(edge => `${edge.from}->${edge.to}`)).toEqual(
    expectedEdges,
  );
  expect(geometry.edges).toHaveLength(6);
  expectNoNonSharedSegmentOverlap(geometry.edges);
  for (const edge of geometry.edges)
    for (const node of geometry.nodes) {
      if (node.id === edge.from || node.id === edge.to) continue;
      expect(routeTouchesNode(edge, node)).toBe(false);
    }
});

test.each(['join', 'fork'] as const)(
  'a simple %s uses one direct branch without a detour loop',
  kind => {
    const tasks =
      kind === 'join'
        ? [
            graphTask('A', [], 0),
            graphTask('B', [], 1),
            graphTask('R', ['A', 'B'], 2),
          ]
        : [
            graphTask('S', [], 0),
            graphTask('A', ['S'], 1),
            graphTask('B', ['S'], 2),
          ];
    for (const width of [80, 120, 160]) {
      const geometry = computeDependencyGraphGeometry(
        graphModel(tasks, kind === 'join' ? [0, 0, 1] : [0, 1, 1]),
        width,
      );
      expect(geometry.edges).toHaveLength(2);
      for (const edge of geometry.edges) {
        const first = edge.points[0]!;
        const last = edge.points.at(-1)!;
        const distance = edge.points.slice(1).reduce((length, point, index) => {
          const previous = edge.points[index]!;
          return (
            length +
            Math.abs(point.x - previous.x) +
            Math.abs(point.y - previous.y)
          );
        }, 0);
        expect(distance).toBe(
          Math.abs(last.x - first.x) + Math.abs(last.y - first.y),
        );
      }
    }
  },
);

test('six long detours never reuse a non-shared orthogonal segment', () => {
  const roots = Array.from({length: 6}, (_, index) =>
    graphTask(`R${index}`, [], index),
  );
  const middle = Array.from({length: 6}, (_, index) =>
    graphTask(`M${index}`, [`R${index}`], index + 6),
  );
  const targets = Array.from({length: 6}, (_, index) =>
    graphTask(`T${index}`, [`M${index}`, `R${5 - index}`], index + 12),
  );
  const tasks = [...roots, ...middle, ...targets];
  const model = graphModel(tasks, [
    ...Array.from({length: 6}, () => 0),
    ...Array.from({length: 6}, () => 1),
    ...Array.from({length: 6}, () => 2),
  ]);
  const geometry = computeDependencyGraphGeometry(model, 90, 0);
  const longEdges = geometry.edges.filter(
    edge => edge.from.startsWith('R') && edge.to.startsWith('T'),
  );

  expect(geometry.edges).toHaveLength(18);
  expect(longEdges).toHaveLength(6);
  expect(longEdges.every(edge => edge.detoured)).toBe(true);
  expectNoNonSharedSegmentOverlap(geometry.edges);
  for (const edge of geometry.edges)
    for (const node of geometry.nodes) {
      if (node.id === edge.from || node.id === edge.to) continue;
      expect(routeTouchesNode(edge, node)).toBe(false);
    }
});

test('wide graph geometry keeps node order and pan coordinates stable', () => {
  const tasks = Array.from({length: 9}, (_, index) =>
    graphTask(`W${index}`, index === 0 ? [] : [`W${index - 1}`], index),
  );
  const levels = tasks.map((_task, index) => index);
  const model = graphModel(tasks, levels);
  const geometry = computeDependencyGraphGeometry(model, 100, 0);
  const panned = computeDependencyGraphGeometry(model, 100, 24);

  expect(geometry.nodes.map(node => node.id)).toEqual(
    tasks.map(task => task.id),
  );
  expect(geometry.nodes.map(node => node.x)).toEqual(
    panned.nodes.map(node => node.x + 24),
  );
  expect(geometry.maxX).toBeGreaterThan(100);
  expect(geometry.edges).toHaveLength(8);
  expect(geometry.edges.every(edge => !edge.detoured)).toBe(true);
  expect(geometry.edges.every(edge => edge.points.length >= 2)).toBe(true);
});

test('branched and reversed dependency graphs retain every independent route', () => {
  const cases = [
    [[], [], [], [], [3], [2], [1], [0]],
    [[], [0], [], [0, 1, 2], [1, 2], [4], [0, 2, 4, 5], [1]],
    [[], [], [0], [0], [0, 1], [2], [0, 1, 5], [3, 5]],
  ];
  for (const dependencies of cases) {
    const tasks = dependencies.map((needs, index) =>
      graphTask(
        `t${index}`,
        needs.map(id => `t${id}`),
        index,
      ),
    );
    const model = overviewModels({
      version: 1,
      sessionId: 'graph',
      revision: 1,
      storageError: null,
      agents: [],
      tasks,
      dispatches: [{id: 'dispatch', admitted: 0}],
      messages: [],
      notices: [],
    })[0]!;
    for (const width of [80, 120, 160]) {
      const geometry = computeDependencyGraphGeometry(model, width);
      expect(geometry.edges).toHaveLength(dependencies.flat().length);
      expectNoNonSharedSegmentOverlap(geometry.edges);
      for (const edge of geometry.edges)
        for (const node of geometry.nodes)
          expect(routeTouchesNode(edge, node)).toBe(false);
      const panned = computeDependencyGraphGeometry(model, width, 24);
      expect(
        panned.edges.map(edge =>
          edge.points.map(point => ({...point, x: point.x + 24})),
        ),
      ).toEqual(
        geometry.edges.map(edge => edge.points.map(point => ({...point}))),
      );
    }
  }
});

test('Pi host shows a simple join without an extra crossing', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    graphChildModel('GRAPH_JOIN'),
  );
  try {
    await host.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    const admitted = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {key: 'a', name: 'A', prompt: 'GRAPH_JOIN_A', workspace: 'live'},
          {key: 'b', name: 'B', prompt: 'GRAPH_JOIN_B', workspace: 'live'},
          {
            key: 'r',
            name: 'R',
            prompt: 'GRAPH_JOIN_R',
            needs: ['a', 'b'],
            workspace: 'live',
          },
        ],
      }),
    );
    expect(admitted).toContain('"status":"accepted"');
    await waitForSettled(host, 8);
    await host.command('/agents');
    await host.terminal.screen.waitForText('dependency graph', {
      timeoutMs: 5000,
    });
    const screen = stripVTControlCharacters(await host.terminal.screen.text());
    expect(screen).toContain('Edges 2');
    expect(screen).not.toMatch(/[╪╫]/u);
    expect(screen).toContain('┬');
    expect(screen).toContain('A · GRAPH_');
    expect(screen).toContain('B · GRAPH_');
    expect(screen).toContain('R · GRAPH_');
  } finally {
    await host.close();
  }
}, 45000);

test('Pi host shows the actual mixed dependency edges and selectable nodes', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    graphChildModel('GRAPH_MIXED'),
  );
  try {
    await host.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    const admitted = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {key: 'a', name: 'A', prompt: 'GRAPH_MIXED_A', workspace: 'live'},
          {key: 'x', name: 'X', prompt: 'GRAPH_MIXED_X', workspace: 'live'},
          {
            key: 'b',
            name: 'B',
            prompt: 'GRAPH_MIXED_B',
            needs: ['a'],
            workspace: 'live',
          },
          {
            key: 'y',
            name: 'Y',
            prompt: 'GRAPH_MIXED_Y',
            needs: ['x'],
            workspace: 'live',
          },
          {
            key: 'c',
            name: 'C',
            prompt: 'GRAPH_MIXED_C',
            needs: ['x', 'b'],
            workspace: 'live',
          },
          {
            key: 'd',
            name: 'D',
            prompt: 'GRAPH_MIXED_D',
            needs: ['a', 'y'],
            workspace: 'live',
          },
        ],
      }),
    );
    expect(admitted).toContain('"status":"accepted"');
    await waitForSettled(host, 8);
    await host.command('/agents');
    await host.terminal.screen.waitForText('dependency graph', {
      timeoutMs: 5000,
    });
    let screen = stripVTControlCharacters(await host.terminal.screen.text());
    expect(screen).toContain('Edges 6');
    expect(screen).not.toContain('Edges 7');
    expect(screen).toMatch(/[╪╫]/u);
    for (const name of ['A', 'X', 'B', 'Y', 'C', 'D'])
      expect(screen).toContain(`${name} · GRAPH_M`);

    for (const name of ['X', 'B', 'Y', 'C', 'D']) {
      await host.terminal.keyboard.type('j');
      await host.terminal.screen.waitForText(`● ${name} ·`, {
        timeoutMs: 5000,
      });
    }
    screen = stripVTControlCharacters(await host.terminal.screen.text());
    expect(screen).toContain('● D · GRAPH_M');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('dependency graph', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('l');
    await host.terminal.screen.waitForText('Edges 6', {timeoutMs: 5000});
  } finally {
    await host.close();
  }
}, 45000);

test('Pi host renders six long detours as actual crossing routes', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    graphChildModel('GRAPH_MANY'),
  );
  try {
    await host.terminal.resize({cols: 180, rows: 48});
    await host.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    const tasks = [
      ...Array.from({length: 6}, (_, index) => ({
        key: `r${index}`,
        name: `R${index}`,
        prompt: `GRAPH_MANY_R${index}`,
        workspace: 'live' as const,
      })),
      ...Array.from({length: 6}, (_, index) => ({
        key: `m${index}`,
        name: `M${index}`,
        prompt: `GRAPH_MANY_M${index}`,
        needs: [`r${index}`],
        workspace: 'live' as const,
      })),
      ...Array.from({length: 6}, (_, index) => ({
        key: `t${index}`,
        name: `T${index}`,
        prompt: `GRAPH_MANY_T${index}`,
        needs: [`m${index}`, `r${5 - index}`],
        workspace: 'live' as const,
      })),
    ];
    const admitted = await host.invoke(
      'subagent',
      JSON.stringify({command: 'dispatch', tasks}),
    );
    expect(admitted).toContain('"status":"accepted"');
    await waitForSettled(host, 32);
    await host.command('/agents');
    await host.terminal.screen.waitForText('dependency graph', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.frame({settleMs: 100, deadlineMs: 5000});
    const screen = stripVTControlCharacters(await host.terminal.screen.text());
    expect(screen).toContain('Edges 18');
    expect(screen).toMatch(/[╪╫]/u);
    expect(screen).toContain('R0 · GRAPH_');
    expect(screen).toContain('T5 · GRAPH_');
  } finally {
    await host.close();
  }
}, 60000);

test('Pi host pans a wide chain without losing true edges or selection', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    graphChildModel('GRAPH_CHAIN'),
  );
  try {
    await host.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    const tasks = Array.from({length: 9}, (_, index) => ({
      key: `w${index}`,
      name: `W${index}`,
      prompt: `GRAPH_CHAIN_${index}`,
      needs: index === 0 ? undefined : [`w${index - 1}`],
      workspace: 'live' as const,
    }));
    const admitted = await host.invoke(
      'subagent',
      JSON.stringify({command: 'dispatch', tasks}),
    );
    expect(admitted).toContain('"status":"accepted"');
    await waitForSettled(host, 16);
    await host.command('/agents');
    await host.terminal.screen.waitForText('dependency graph', {
      timeoutMs: 5000,
    });
    let screen = stripVTControlCharacters(await host.terminal.screen.text());
    expect(screen).toContain('Edges 8');
    expect(screen).toContain('right edge clipped');
    expect(screen).not.toContain('Edges 9');

    for (let index = 0; index < 80; index++)
      await host.terminal.keyboard.type('l');
    await host.terminal.screen.frame({settleMs: 100, deadlineMs: 5000});
    await host.terminal.screen.waitForText('W8 ·', {timeoutMs: 5000});
    for (let index = 0; index < 8; index++)
      await host.terminal.keyboard.type('j');
    await host.terminal.screen.waitForText('● W8 ·', {timeoutMs: 5000});
    screen = stripVTControlCharacters(await host.terminal.screen.text());
    expect(screen).toContain('Edges 8');
    expect(screen).toContain('● W8 ·');
  } finally {
    await host.close();
  }
}, 45000);
