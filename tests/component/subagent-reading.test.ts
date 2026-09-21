import {expect, test} from 'bun:test';
import {initTheme, type Theme} from '@earendil-works/pi-coding-agent';
import {stripTerminalSequences} from '@earendil-works/pi-tui';
import {Inspection} from '../../src/subagent/inspection';
import type {RunSnapshot, TaskSnapshot} from '../../src/subagent/records';

test('opening Prompt while reading older output does not follow a new reply', () => {
  initTheme('dark', false);
  const task: TaskSnapshot = {
    id: 'reader',
    agent: 'reader',
    task: 'Inspect cancellation',
    cwd: '/tmp',
    prompt: '',
    write: false,
    tools: ['read'],
    explicitTools: false,
    needs: [],
    maxRuntimeMs: 1000,
    requestId: 'request',
    status: 'running',
    finalText: Array.from(
      {length: 20},
      (_, index) => `OLD_FINDING_${index}\n`,
    ).join('\n'),
    pendingInstructions: [],
    configurationNotes: [],
    history: [],
  };
  const run: RunSnapshot = {
    id: 'run',
    mode: 'single',
    status: 'running',
    notifyPerTask: false,
    tasks: [task],
    intercom: [],
  };
  const theme: Pick<Theme, 'fg' | 'bold'> = {
    fg: (_color, text) => text,
    bold: text => text,
  };
  const detail = new Inspection({run, task});
  detail.render(80, 12, theme);
  detail.handleInput(']');
  task.finalText = 'NEW_RESPONSE';
  expect(detail.render(80, 12, theme).join('\n')).toContain('New output');
  detail.handleInput('a');
  const activityOpened = detail
    .render(80, 12, theme)
    .map(stripTerminalSequences)
    .join('\n');
  expect(activityOpened).toContain('OLD_FINDING');
  expect(activityOpened).toContain('New output');
  detail.handleInput('p');
  const opened = detail
    .render(80, 12, theme)
    .map(stripTerminalSequences)
    .join('\n');
  expect(opened).toContain('Inspect cancellation');
  expect(opened).toContain('OLD_FINDING');
  expect(opened).not.toContain('NEW_RESPONSE');
  expect(opened).toContain('f latest');
  detail.handleInput('f');
  expect(detail.render(80, 12, theme).join('\n')).toContain('NEW_RESPONSE');
});
