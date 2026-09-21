import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const HistoryEntry = Schema.Struct({
  status: Schema.String,
  finalText: Schema.String,
});
const TaskResult = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  finalText: Schema.String,
  history: Schema.Array(HistoryEntry),
});
const RunResult = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  tasks: Schema.Array(TaskResult),
});

type RunResult = Schema.Schema.Type<typeof RunResult>;
type TaskResult = Schema.Schema.Type<typeof TaskResult>;

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

function requestText(request: PiFixtureRequest): string {
  return request.messages.map(messageText).join('\n');
}

function toolNames(request: PiFixtureRequest): string[] {
  return request.tools?.map(tool => tool.function.name) ?? [];
}

function decodeRun(serialized: string): RunResult {
  return Schema.decodeUnknownSync(RunResult)(JSON.parse(serialized));
}

async function resultForTask(
  host: Awaited<ReturnType<typeof launchPi>>,
  runId: string,
  taskId: string,
): Promise<TaskResult> {
  const serialized = await host.invoke(
    'subagent',
    JSON.stringify({command: 'result', runId, taskId}),
  );
  return Schema.decodeUnknownSync(TaskResult)(JSON.parse(serialized));
}

async function openOnlyChild(
  host: Awaited<ReturnType<typeof launchPi>>,
  agent: string,
): Promise<void> {
  await host.terminal.screen.waitForText('○ main', {timeoutMs: 5000});
  await host.terminal.keyboard.press('ArrowDown');
  await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
  await host.terminal.keyboard.press('ArrowDown');
  await host.terminal.screen.waitForText(`● ${agent}`, {timeoutMs: 5000});
  await host.terminal.keyboard.press('Enter');
  await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
}

function bracketedPaste(value: string): Uint8Array {
  return new TextEncoder().encode(`\u001b[200~${value}\u001b[201~`);
}

test('completed follow-up preserves a pasted draft, context, history, and main draft', async () => {
  const childRequests: PiFixtureRequest[] = [];
  const resizeDraft = Array.from(
    {length: 9},
    (_, index) => `RESIZE_LINE_${String(index + 1).padStart(2, '0')}`,
  ).join('\n');
  const followUpBody = `m/x/p FOLLOWUP_UI ${'PASTE_BODY_'.repeat(130)}`;
  const responseCallback: PiFixtureResponseCallback = request => {
    if (toolNames(request).includes('subagent')) return undefined;
    childRequests.push(request);
    const latest = latestUserText(request);
    if (latest.includes('FOLLOWUP_UI'))
      return {type: 'content', content: 'FOLLOWUP_REPORT'};
    if (latest.includes('INITIAL_UI'))
      return {type: 'content', content: 'INITIAL_REPORT'};
    return undefined;
  };
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    responseCallback,
  );
  try {
    const initial = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          agent: 'reviewer',
          task: 'INITIAL_UI',
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
    const initialTask = initial.tasks[0];
    if (initialTask === undefined) throw new Error('Missing initial task.');
    expect(initial.status).toBe('completed');
    expect(initialTask.status).toBe('completed');

    await host.terminal.keyboard.type('MAIN_DRAFT_RETAINED');
    await openOnlyChild(host, 'reviewer');
    await host.terminal.keyboard.type('p');
    await host.terminal.screen.waitForText('INITIAL_UI', {timeoutMs: 5000});
    await host.terminal.keyboard.type('p');
    await host.terminal.screen.waitForText('m follow-up', {timeoutMs: 5000});

    await host.terminal.keyboard.type('m');
    await host.terminal.screen.waitForText('Follow-up reviewer', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type(resizeDraft);
    await host.terminal.screen.waitForText('RESIZE_LINE_09', {
      timeoutMs: 5000,
    });
    await host.terminal.resize({cols: 80, rows: 16});
    await host.terminal.screen.waitForText(
      'Resize terminal to edit this message.',
      {timeoutMs: 5000},
    );
    await host.terminal.screen.waitForText('esc back', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('m follow-up', {timeoutMs: 5000});

    await host.terminal.resize({cols: 80, rows: 24});
    await host.terminal.keyboard.type('m');
    await host.terminal.screen.waitForText('RESIZE_LINE_09', {
      timeoutMs: 5000,
    });
    for (const _character of resizeDraft)
      await host.terminal.keyboard.press('Backspace');
    await host.terminal.keyboard.write(bracketedPaste(followUpBody));
    await host.terminal.screen.waitForText('[paste #1', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('Follow-up reviewer'),
      {timeoutMs: 10000},
    );
    const followUpRequest = childRequests.find(
      request => latestUserText(request) === followUpBody,
    );
    if (followUpRequest === undefined)
      throw new Error('Provider did not receive the full follow-up body.');
    expect(requestText(followUpRequest)).toContain('INITIAL_UI');
    expect(requestText(followUpRequest)).toContain('INITIAL_REPORT');
    expect(latestUserText(followUpRequest)).toBe(followUpBody);

    await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('f');
    await host.terminal.screen.waitForText('FOLLOWUP_REPORT', {
      timeoutMs: 10000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● reviewer', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('esc back'),
      {timeoutMs: 5000},
    );
    await host.terminal.screen.waitForText('MAIN_DRAFT_RETAINED', {
      timeoutMs: 5000,
    });
    for (const _character of 'MAIN_DRAFT_RETAINED')
      await host.terminal.keyboard.press('Backspace');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('MAIN_DRAFT_RETAINED'),
      {timeoutMs: 5000},
    );
    const continued = await resultForTask(host, initial.id, initialTask.id);
    expect(continued.status).toBe('completed');
    expect(continued.finalText).toContain('FOLLOWUP_REPORT');
    expect(continued.history).toHaveLength(1);
    expect(continued.history[0]?.finalText).toContain('INITIAL_REPORT');
  } finally {
    await host.close();
  }
}, 60000);

test('replies to a live parent question with its original question visible', async () => {
  const question = 'QUESTION_FROM_CHILD: which file should I inspect?';
  const childRequests: PiFixtureRequest[] = [];
  const responseCallback: PiFixtureResponseCallback = request => {
    if (toolNames(request).includes('subagent')) return undefined;
    childRequests.push(request);
    const latest = latestUserText(request);
    const lastMessage = request.messages.at(-1);
    if (lastMessage?.role === 'tool')
      return {type: 'content', content: 'QUESTION_REPORT'};
    if (latest.includes('QUESTION_UI'))
      return {
        type: 'tool_call',
        name: 'ask_parent',
        arguments: JSON.stringify({question}),
      };
    return undefined;
  };
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    responseCallback,
  );
  try {
    const awaiting = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          agent: 'questioner',
          task: 'QUESTION_UI',
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
    const task = awaiting.tasks[0];
    if (task === undefined) throw new Error('Missing question task.');
    expect(task.status).toBe('awaiting_parent');
    await openOnlyChild(host, 'questioner');
    await host.terminal.screen.waitForText(question, {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Reply questioner', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain(
      `Question: ${question}`,
    );
    await host.terminal.keyboard.type('REPLY_UI');
    await host.terminal.screen.waitForText('REPLY_UI', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText(question, {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('REPLY_UI', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');

    await host.terminal.screen.waitForText('QUESTION_REPORT', {
      timeoutMs: 10000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● questioner', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('esc back'),
      {timeoutMs: 5000},
    );
    const completed = await resultForTask(host, awaiting.id, task.id);
    expect(completed.finalText).toContain('QUESTION_REPORT');
    expect(
      childRequests.some(request => requestText(request).includes('REPLY_UI')),
    ).toBe(true);
  } finally {
    await host.close();
  }
}, 60000);

test('stop confirmation can be dismissed and then stops only the selected child', async () => {
  const question = 'STOP_TARGET_IS_WAITING';
  const responseCallback: PiFixtureResponseCallback = request => {
    if (toolNames(request).includes('subagent')) return undefined;
    const latest = latestUserText(request);
    const lastMessage = request.messages.at(-1);
    if (latest.includes('STOP_UI_TASK') && lastMessage?.role !== 'tool')
      return {
        type: 'tool_call',
        name: 'ask_parent',
        arguments: JSON.stringify({question}),
      };
    if (latest.includes('SIBLING_UI_TASK'))
      return {type: 'content', content: 'SIBLING_REPORT'};
    return undefined;
  };
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    responseCallback,
  );
  try {
    const dispatched = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {id: 'target', agent: 'target', task: 'STOP_UI_TASK'},
            {id: 'sibling', agent: 'sibling', task: 'SIBLING_UI_TASK'},
          ],
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
    expect(dispatched.status).toBe('running');
    await host.terminal.screen.waitForText('○ main', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
    await host.terminal.keyboard.press('ArrowDown');
    await host.terminal.screen.waitForText('● target', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Waiting for main', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('x');
    await host.terminal.screen.waitForText('Confirming requests cancellation', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Waiting for main', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).not.toContain(
      'Confirming requests cancellation',
    );

    await host.terminal.keyboard.type('x');
    await host.terminal.screen.waitForText('Confirming requests cancellation', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Stopped', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).not.toContain(
      'Confirming requests cancellation',
    );
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● target', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      snapshot => !snapshot.text.includes('esc back'),
      {timeoutMs: 5000},
    );
    const stopped = await resultForTask(host, dispatched.id, 'target');
    expect(stopped.status).toBe('stopped');
    const sibling = await resultForTask(host, dispatched.id, 'sibling');
    expect(sibling.status).toBe('completed');
    expect(sibling.finalText).toContain('SIBLING_REPORT');
  } finally {
    await host.close();
  }
}, 60000);
