import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';

test('batch dispatch rejects misplaced per-agent controls before any child starts', async () => {
  let childCalls = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      if (request.tools?.some(tool => tool.function.name === 'subagent'))
        return undefined;
      childCalls++;
      return {type: 'content', content: 'UNEXPECTED_CHILD'};
    },
  );
  try {
    for (const form of ['tasks', 'chain']) {
      for (const misplaced of [
        {tools: ['read']},
        {prompt: 'Required role instruction'},
        {write: true},
        {model: 'fixture'},
        {thinking: 'off'},
      ]) {
        const result = await host.invoke(
          'subagent',
          JSON.stringify({
            command: 'dispatch',
            [form]: [{agent: 'reader', task: 'Inspect current files'}],
            ...misplaced,
            autoAwait: true,
            notifyPerTask: false,
          }),
        );
        expect(result).toContain('on each item');
        expect(result).not.toContain('"tasks"');
        expect(childCalls).toBe(0);
      }
    }
    expect(await host.terminal.screen.text()).not.toContain('○ reader');
  } finally {
    await host.close();
  }
}, 60000);
