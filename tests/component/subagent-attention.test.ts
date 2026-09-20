import {expect, test} from 'bun:test';
import {newAssignment} from '../../src/subagent/admission';
import type {AgentRecord, FleetRecord} from '../../src/subagent/records';
import {BrowseNavigator} from '../../src/subagent/ui/browser';
import {countAttention} from '../../src/subagent/ui/format';

function recoveredFleet(): FleetRecord {
  const agent: AgentRecord = {
    id: 'reviewer',
    name: 'reviewer',
    dispatchId: 'dispatch',
    parentAgentId: null,
    createdAt: 1,
    depth: 1,
    configuration: {
      model: 'fixture/model',
      thinking: 'off',
      tools: ['subagent'],
      ceiling: ['subagent'],
      cwd: '.',
      workspace: 'direct',
      instructions: '',
      role: null,
      copyHistory: false,
      executionTimeoutMs: null,
      extensions: [],
      baseline: null,
      include: [],
    },
    currentTools: ['subagent'],
    sessionFile: null,
    workspace: null,
    held: false,
    released: false,
  };
  const failed = {
    ...newAssignment(agent, 'Original review', 'Original review', null, {}),
    phase: 'ended' as const,
    outcome: 'failed' as const,
    durability: 'saved' as const,
  };
  const recovered = {
    ...newAssignment(agent, 'Recovered review', 'Recovered review', null, {}),
    phase: 'ended' as const,
    outcome: 'fulfilled' as const,
    durability: 'saved' as const,
  };
  return {
    version: 1,
    sessionId: 'session',
    revision: 1,
    storageError: null,
    agents: [agent],
    tasks: [failed, recovered],
    dispatches: [{id: 'dispatch', admitted: 2}],
    messages: [],
    notices: [],
  };
}

test('successful recovery removes historical failure from current attention', () => {
  const snapshot = recoveredFleet();
  const browser = new BrowseNavigator();
  browser.toggleAttention(snapshot);
  expect(countAttention(snapshot)).toBe(0);
  expect(browser.fleetRows(snapshot)).toEqual([{id: 'main'}]);
  expect(snapshot.tasks[0]?.outcome).toBe('failed');

  const failedAgain: FleetRecord = {
    ...snapshot,
    tasks: snapshot.tasks.map(task => ({...task, outcome: 'failed'})),
  };
  expect(countAttention(failedAgain)).toBe(1);
  expect(browser.fleetRows(failedAgain)).toEqual([
    {id: 'main'},
    {id: 'reviewer'},
  ]);
});

test('pending questions remain visible to main after a newer assignment', () => {
  const snapshot = recoveredFleet();
  const oldTask = snapshot.tasks[0];
  if (!oldTask) throw new Error('Missing old assignment.');
  const question = {
    id: 'question',
    kind: 'question' as const,
    fromTaskId: oldTask.id,
    taskId: null,
    questionId: null,
    text: 'Keep partial work?',
    receivedAt: 1,
    consumedAt: null,
    expiresAt: null,
  };
  const pending = {...snapshot, messages: [question]};
  expect(countAttention(pending)).toBe(1);
  const answered: FleetRecord = {
    ...pending,
    messages: [
      question,
      {
        ...question,
        id: 'reply',
        kind: 'reply',
        fromTaskId: null,
        taskId: oldTask.id,
        questionId: question.id,
        text: 'Keep it.',
        receivedAt: 2,
      },
    ],
  };
  expect(countAttention(answered)).toBe(0);
});

test('attention opens the earlier assignment carrying an unresolved notice', () => {
  const snapshot = recoveredFleet();
  const oldTask = snapshot.tasks[0];
  if (!oldTask) throw new Error('Missing old assignment.');
  const pending: FleetRecord = {
    ...snapshot,
    notices: [
      {
        id: 'message:late-message',
        taskId: oldTask.id,
        text: 'Late information for the earlier review.',
        acknowledged: false,
      },
    ],
  };
  const browser = new BrowseNavigator();
  browser.open('fleet', pending);
  browser.toggleAttention(pending);
  expect(countAttention(pending)).toBe(1);
  expect(browser.fleetRows(pending)).toEqual([{id: 'main'}, {id: 'reviewer'}]);
  browser.selectFleetIndex(1, pending);
  expect(browser.currentTaskForAgent(pending)).toBe(oldTask.id);

  const acknowledged = {
    ...pending,
    notices: pending.notices.map(notice => ({...notice, acknowledged: true})),
  };
  browser.reconcile(acknowledged);
  expect(countAttention(acknowledged)).toBe(0);
  expect(browser.fleetRows(acknowledged)).toEqual([{id: 'main'}]);
});
