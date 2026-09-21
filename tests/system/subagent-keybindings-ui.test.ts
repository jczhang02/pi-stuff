import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi, type PiFixtureRequest} from './fixtures/pi-terminal';

const Run = Schema.Struct({
  id: Schema.String,
  tasks: Schema.Array(Schema.Struct({id: Schema.String})),
});

const KEYBINDINGS = {
  'tui.input.newLine': 'ctrl+n',
  'tui.input.submit': 'ctrl+q',
  'tui.editor.historyPrevious': 'ctrl+p',
  'tui.select.down': 'j',
  'tui.select.up': 'k',
  'tui.select.confirm': 'ctrl+y',
  'tui.select.cancel': 'ctrl+g',
};

function messageText(message: PiFixtureRequest['messages'][number]): string {
  const content = message.content;
  if (content === undefined || content === null) return '';
  if (Schema.is(Schema.String)(content)) return content;
  return content.map(block => block.text ?? '').join('');
}

function latestUserText(request: PiFixtureRequest): string {
  const message = [...request.messages]
    .reverse()
    .find(candidate => candidate.role === 'user');
  return message === undefined ? '' : messageText(message);
}

function mainAndChildCallback(request: PiFixtureRequest) {
  const text = latestUserText(request);
  if (
    text.includes('MAIN_PRIORITY_FIRST') &&
    text.includes('MAIN_PRIORITY_SECOND') &&
    text.includes('HISTORY_RECALL')
  )
    return {type: 'content' as const, content: 'MAIN_HISTORY_RESPONSE'};
  if (
    text.includes('MAIN_PRIORITY_FIRST') &&
    text.includes('MAIN_PRIORITY_SECOND')
  )
    return {type: 'content' as const, content: 'MAIN_REMAP_RESPONSE'};
  if (request.tools?.some(tool => tool.function.name === 'subagent'))
    return undefined;
  if (text.includes('KEYBIND_CHILD_TASK'))
    return {type: 'content' as const, content: 'KEYBIND_CHILD_REPORT'};
  return undefined;
}

function followUpCallback(request: PiFixtureRequest) {
  const text = latestUserText(request);
  if (request.tools?.some(tool => tool.function.name === 'subagent'))
    return undefined;
  if (text.includes('KEYBIND_FOLLOWUP_FIRST'))
    return {type: 'content' as const, content: 'KEYBIND_FOLLOWUP_RESPONSE'};
  if (text.includes('KEYBIND_CHILD_TASK'))
    return {type: 'content' as const, content: 'KEYBIND_CHILD_REPORT'};
  return undefined;
}

async function applyKeybindings(
  host: Awaited<ReturnType<typeof launchPi>>,
): Promise<void> {
  await writeFile(
    join(host.agent, 'keybindings.json'),
    JSON.stringify(KEYBINDINGS),
  );
  await host.command('/reload');
  await host.terminal.screen.waitForText('Reloaded keybindings', {
    timeoutMs: 5000,
  });
}

async function dispatchChild(
  host: Awaited<ReturnType<typeof launchPi>>,
): Promise<{runId: string; taskId: string}> {
  const run = Schema.decodeUnknownSync(Run)(
    JSON.parse(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          agent: 'reader',
          task: 'KEYBIND_CHILD_TASK',
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    ),
  );
  const task = run.tasks[0];
  if (task === undefined) throw new Error('Missing child task.');
  return {runId: run.id, taskId: task.id};
}

async function openChildDetail(
  host: Awaited<ReturnType<typeof launchPi>>,
): Promise<void> {
  await host.terminal.keyboard.press('ArrowDown');
  await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
  await host.terminal.keyboard.type('j');
  await host.terminal.screen.waitForText('● reader', {timeoutMs: 5000});
  await host.terminal.keyboard.press('Control+Y');
  await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
}

test('native remaps preserve multiline, history, completion, and FleetView priority', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    mainAndChildCallback,
  );
  try {
    await dispatchChild(host);
    await applyKeybindings(host);

    await host.terminal.keyboard.type('MAIN_PRIORITY_FIRST');
    await host.terminal.keyboard.press('Control+N');
    await host.terminal.keyboard.type('MAIN_PRIORITY_SECOND');
    await host.terminal.screen.waitForText('MAIN_PRIORITY_SECOND', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('ArrowUp');
    expect(await host.terminal.screen.text()).not.toContain('esc back');
    await host.terminal.keyboard.press('ArrowDown');
    expect(await host.terminal.screen.text()).not.toContain('esc back');
    await host.terminal.keyboard.press('Control+Q');
    await host.terminal.screen.waitForText('MAIN_REMAP_RESPONSE', {
      timeoutMs: 5000,
    });

    await host.terminal.keyboard.press('Control+P');
    await host.terminal.keyboard.type(' HISTORY_RECALL');
    await host.terminal.keyboard.press('Control+Q');
    await host.terminal.screen.waitForText('MAIN_HISTORY_RESPONSE', {
      timeoutMs: 5000,
    });

    await host.terminal.keyboard.type('/he');
    await host.terminal.screen.waitForText('hotkeys', {timeoutMs: 5000});
    await host.terminal.keyboard.type('j');
    await host.terminal.screen.waitForText('→ host-reload', {
      timeoutMs: 5000,
    });
    const completion = await host.terminal.screen.text();
    expect(completion).not.toContain('/hej');
    expect(completion).not.toContain('esc back');
    await host.terminal.keyboard.press('Escape');
    await host.terminal.keyboard.press('Backspace');
    await host.terminal.keyboard.press('Backspace');
    await host.terminal.screen.waitUntil(
      async () => !(await host.terminal.screen.text()).includes('/he'),
      {timeoutMs: 5000},
    );

    await openChildDetail(host);
  } finally {
    await host.close();
  }
}, 60000);

test('completed follow-up composer keeps letters local and submits remapped multiline input', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    followUpCallback,
  );
  try {
    await dispatchChild(host);
    await applyKeybindings(host);
    await openChildDetail(host);
    await host.terminal.keyboard.type('m');
    await host.terminal.screen.waitForText('Follow-up reader', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('itg KEYBIND_FOLLOWUP_FIRST');
    await host.terminal.keyboard.press('Control+N');
    await host.terminal.keyboard.type('FOLLOWUP_SECOND');
    const composer = await host.terminal.screen.text();
    expect(composer).toContain('itg KEYBIND_FOLLOWUP_FIRST');
    expect(composer).toContain('FOLLOWUP_SECOND');
    expect(composer).toContain('Follow-up reader');
    await host.terminal.keyboard.press('Control+Q');
    await host.terminal.screen.waitForText('KEYBIND_FOLLOWUP_RESPONSE', {
      timeoutMs: 10000,
    });
    expect(await host.terminal.screen.text()).not.toContain('Follow-up reader');
  } finally {
    await host.close();
  }
}, 60000);
