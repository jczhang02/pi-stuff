import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {visibleWidth} from '@earendil-works/pi-tui';
import type {Cell, Frame} from '@kitlangton/terminal-control';
import {
  RunSnapshot as RunSnapshotSchema,
  type RunSnapshot,
} from '../../src/subagent/records';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const decodeRun = Schema.decodeUnknownSync(
  Schema.fromJsonString(RunSnapshotSchema),
);

const tasks = [
  {agent: 'alpha', marker: 'FLEET_TASK_00', output: 10},
  {agent: 'beta', marker: 'FLEET_TASK_01', output: 11},
  {agent: '中文审查员', marker: 'FLEET_TASK_02', output: 12},
  {
    agent: 'long-agent-name-012345678901234567890123',
    marker: 'FLEET_TASK_03',
    output: 13,
  },
  {agent: 'gamma', marker: 'FLEET_TASK_04', output: 14},
  {agent: 'delta', marker: 'FLEET_TASK_05', output: 15},
  {agent: 'epsilon', marker: 'FLEET_TASK_06', output: 16},
  {agent: 'zeta', marker: 'FLEET_TASK_07', output: 17},
  {agent: '审查甲乙丙丁', marker: 'FLEET_TASK_08', output: 18},
  {agent: 'wide界面', marker: 'FLEET_TASK_09', output: 19},
  {agent: 'reviewer-10', marker: 'FLEET_TASK_10', output: 20},
  {agent: 'reviewer-11', marker: 'FLEET_TASK_11', output: 21},
  {agent: 'reviewer-12', marker: 'FLEET_TASK_12', output: 22},
  {agent: 'reviewer-13', marker: 'FLEET_TASK_13', output: 23},
  {agent: 'reviewer-14', marker: 'FLEET_TASK_14', output: 24},
  {agent: '终端最后Child', marker: 'FLEET_TASK_15', output: 25},
] as const;

function messageText(message: PiFixtureRequest['messages'][number]): string {
  const content = message.content;
  if (content === undefined || content === null) return '';
  if (Schema.is(Schema.String)(content)) return content;
  return content.map(block => block.text ?? '').join('');
}

function latestUserText(request: PiFixtureRequest): string {
  return (
    request.messages
      .filter(message => message.role === 'user')
      .map(messageText)
      .at(-1) ?? ''
  );
}

function toolNames(request: PiFixtureRequest): string[] {
  return request.tools?.map(tool => tool.function.name) ?? [];
}

function rowCells(frame: Frame, y: number): Cell[] {
  return frame.cells
    .filter(cell => cell.y === y)
    .sort((left, right) => left.x - right.x);
}

function rowText(cells: readonly Cell[]): string {
  return cells.map(cell => cell.text).join('');
}

function fleetRow(frame: Frame, marker: string): Cell[] | undefined {
  for (let y = 0; y < frame.rows; y++) {
    const cells = rowCells(frame, y);
    if (
      (cells[0]?.text === '○' || cells[0]?.text === '●') &&
      rowText(cells).includes(marker)
    )
      return cells;
  }
  return undefined;
}

function sequenceX(cells: readonly Cell[], sequence: string): number {
  for (let index = 0; index <= cells.length - sequence.length; index++) {
    if (
      cells
        .slice(index, index + sequence.length)
        .map(cell => cell.text)
        .join('') === sequence
    )
      return cells[index]?.x ?? -1;
  }
  return -1;
}

function assertFleetGeometry(
  frame: Frame,
  visibleTaskIndexes: readonly number[],
): void {
  const descriptionStarts = visibleTaskIndexes.map(index => {
    const task = tasks[index];
    if (task === undefined) throw new Error(`Missing fixture task ${index}.`);
    const cells = fleetRow(frame, task.marker);
    if (cells === undefined)
      throw new Error(`Fleet row is not visible: ${task.marker}.`);
    const descriptionX = sequenceX(cells, task.marker);
    expect(descriptionX).toBeGreaterThan(0);
    const token = `↓ ${task.output} tokens`;
    const tokenX = sequenceX(cells, token);
    expect(tokenX).toBeGreaterThan(0);
    expect(tokenX + visibleWidth(token)).toBe(frame.cols);
    return descriptionX;
  });
  expect(new Set(descriptionStarts).size).toBe(1);
}

function taskByAgent(run: RunSnapshot, agent: string) {
  const task = run.tasks.find(candidate => candidate.agent === agent);
  if (task === undefined) throw new Error(`Missing task for ${agent}.`);
  return task;
}

test('Fleet keeps wide names aligned and the last child visible across viewports', async () => {
  const responseCallback: PiFixtureResponseCallback = request => {
    if (toolNames(request).includes('subagent')) return undefined;
    const marker = latestUserText(request);
    const task = tasks.find(candidate => marker.includes(candidate.marker));
    if (task === undefined) return undefined;
    return {
      type: 'content',
      content: `${task.marker}_REPORT`,
      usage: {input: 30 + task.output, output: task.output},
    };
  };
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    responseCallback,
  );
  try {
    const run = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: tasks.map(task => ({
            id: task.marker.toLowerCase(),
            agent: task.agent,
            task: task.marker,
          })),
          concurrency: 4,
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
    expect(run.status).toBe('completed');
    expect(run.tasks).toHaveLength(tasks.length);
    for (const task of tasks) {
      const result = taskByAgent(run, task.agent);
      expect(result.status).toBe('completed');
      expect(result.finalText).toBe(`${task.marker}_REPORT`);
      expect(result.usage?.input).toBe(30 + task.output);
      expect(result.usage?.output).toBe(task.output);
    }

    await host.terminal.resize({cols: 150, rows: 50});
    await host.terminal.screen.waitUntil(
      snapshot => snapshot.frame.cols === 150 && snapshot.frame.rows === 50,
      {timeoutMs: 5000},
    );
    await host.terminal.keyboard.type('MAIN_FLEET_DRAFT');
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('esc back', {timeoutMs: 5000});
    await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
    for (let index = 0; index < tasks.length; index++)
      await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● 终端最后Child', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.waitForText('9–16 / 16 agents', {
      timeoutMs: 5000,
    });
    let frame = await host.terminal.screen.frame();
    expect(frame.cols).toBe(150);
    expect(frame.rows).toBe(50);
    assertFleetGeometry(frame, [8, 9, 10, 11, 12, 13, 14, 15]);

    await host.terminal.resize({cols: 120, rows: 36});
    await host.terminal.screen.waitUntil(
      snapshot =>
        snapshot.frame.cols === 120 &&
        snapshot.frame.rows === 36 &&
        snapshot.text.includes('9–16 / 16 agents'),
      {timeoutMs: 5000},
    );
    await host.terminal.screen.waitForText('● 终端最后Child', {
      timeoutMs: 5000,
    });
    frame = await host.terminal.screen.frame();
    assertFleetGeometry(frame, [8, 9, 10, 11, 12, 13, 14, 15]);

    await host.terminal.resize({cols: 80, rows: 24});
    await host.terminal.screen.waitUntil(
      snapshot =>
        snapshot.frame.cols === 80 &&
        snapshot.frame.rows === 24 &&
        snapshot.text.includes('11–16 / 16 agents'),
      {timeoutMs: 5000},
    );
    await host.terminal.screen.waitForText('● 终端最后Child', {
      timeoutMs: 5000,
    });
    frame = await host.terminal.screen.frame();
    assertFleetGeometry(frame, [10, 11, 12, 13, 14, 15]);

    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      snapshot =>
        !snapshot.text.includes('esc back') &&
        snapshot.text.includes('MAIN_FLEET_DRAFT'),
      {timeoutMs: 5000},
    );
    expect(await host.terminal.screen.text()).toContain('MAIN_FLEET_DRAFT');

    // Reopening the fleet proves Escape returned to the editor without
    // discarding the selected last child.
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('esc back', {timeoutMs: 5000});
    await host.terminal.screen.waitForText('● 终端最后Child', {
      timeoutMs: 5000,
    });
  } finally {
    await host.close();
  }
}, 60000);
