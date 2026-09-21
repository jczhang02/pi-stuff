import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const Run = Schema.Struct({
  id: Schema.String,
  tasks: Schema.Array(Schema.Struct({id: Schema.String})),
});

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

type Scenario = Readonly<{
  prompt: string;
  path: string;
  result: string;
}>;

function toolReadingCallback(
  scenarios: readonly Scenario[],
): PiFixtureResponseCallback {
  const issued = new Set<string>();
  return request => {
    if (request.tools?.some(tool => tool.function.name === 'subagent'))
      return undefined;
    const scenario = scenarios.find(candidate =>
      latestUserText(request).includes(candidate.prompt),
    );
    if (scenario === undefined) return undefined;
    if (request.messages.at(-1)?.role === 'tool')
      return {type: 'content', content: scenario.result};
    if (!issued.has(scenario.prompt)) {
      issued.add(scenario.prompt);
      return {
        type: 'tool_call',
        name: 'read',
        arguments: JSON.stringify({path: scenario.path}),
      };
    }
    return {type: 'content', content: scenario.result};
  };
}

async function openTranscript(
  host: Awaited<ReturnType<typeof launchPi>>,
  agent: string,
): Promise<void> {
  await host.terminal.keyboard.type('Keep transcript draft');
  await host.terminal.keyboard.press('ArrowDown');
  await host.terminal.screen.waitForText('● main', {timeoutMs: 5000});
  await host.terminal.keyboard.press('ArrowDown');
  await host.terminal.screen.waitForText(`● ${agent}`, {timeoutMs: 5000});
  await host.terminal.keyboard.press('Enter');
  await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
  await host.terminal.keyboard.type('t');
  await host.terminal.screen.waitForText(`${agent} · Transcript`, {
    timeoutMs: 5000,
  });
}

async function pageToBeginning(
  host: Awaited<ReturnType<typeof launchPi>>,
): Promise<void> {
  for (let index = 0; index < 40; index++)
    await host.terminal.keyboard.type('[');
}

async function pageForwardAndRead(
  host: Awaited<ReturnType<typeof launchPi>>,
): Promise<string> {
  const before = await host.terminal.screen.text();
  await host.terminal.keyboard.type(']');
  try {
    await host.terminal.screen.waitUntil(
      async () => (await host.terminal.screen.text()) !== before,
      {timeoutMs: 1000},
    );
  } catch {
    // The final page is allowed to remain unchanged.
  }
  return host.terminal.screen.text();
}

test('transcript renders native child tool calls and keeps requests chronological', async () => {
  const firstPrompt = 'TRANSCRIPT_REQUEST_ONE';
  const secondPrompt = 'TRANSCRIPT_REQUEST_TWO';
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    toolReadingCallback([
      {
        prompt: firstPrompt,
        path: 'transcript-input.txt',
        result: 'TRANSCRIPT_TOOL_REPORT',
      },
      {
        prompt: secondPrompt,
        path: 'transcript-input.txt',
        result: 'TRANSCRIPT_FOLLOW_UP_REPORT',
      },
    ]),
  );
  try {
    await writeFile(
      join(host.directory, 'transcript-input.txt'),
      'TRANSCRIPT_TOOL_PAYLOAD\n',
    );
    const run = Schema.decodeUnknownSync(Run)(
      JSON.parse(
        await host.invoke(
          'subagent',
          JSON.stringify({
            command: 'dispatch',
            agent: 'reader',
            task: firstPrompt,
            tools: ['read'],
            autoAwait: true,
            notifyPerTask: false,
          }),
        ),
      ),
    );
    const task = run.tasks[0];
    if (task === undefined) throw new Error('Missing child task.');
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'follow-up',
        runId: run.id,
        taskId: task.id,
        message: secondPrompt,
        autoAwait: true,
      }),
    );

    await openTranscript(host, 'reader');
    await host.terminal.screen.waitForText('TRANSCRIPT_FOLLOW_UP_REPORT', {
      timeoutMs: 5000,
    });
    await pageToBeginning(host);
    await host.terminal.screen.waitForText(firstPrompt, {timeoutMs: 5000});
    const pages = [await host.terminal.screen.text()];

    for (let index = 0; index < 40; index++) {
      await host.terminal.keyboard.type(']');
      pages.push(await host.terminal.screen.text());
    }
    const transcript = pages.join('\n');
    expect(transcript).toContain('TRANSCRIPT_TOOL_PAYLOAD');
    expect(transcript).not.toContain('Tool result not recorded.');
    expect(transcript.indexOf(firstPrompt)).toBeGreaterThanOrEqual(0);
    pages.push(await host.terminal.screen.text());
    const finalTranscript = pages.join('\n');
    expect(finalTranscript).toContain('TRANSCRIPT_FOLLOW_UP_REPORT');
    expect(finalTranscript.indexOf(firstPrompt)).toBeLessThan(
      finalTranscript.indexOf(secondPrompt),
    );
  } finally {
    await host.close();
  }
}, 60000);

test('long recorded read output remains reachable without synthetic truncation', async () => {
  const prompt = 'TRANSCRIPT_LONG_REQUEST';
  const firstLine = 'LONG_TOOL_FIRST';
  const lastLine = 'LONG_TOOL_LAST';
  const content = [
    firstLine,
    ...Array.from({length: 60}, (_, index) => `LONG_TOOL_LINE_${index}`),
    lastLine,
  ].join('\n');
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    toolReadingCallback([
      {prompt, path: 'long-transcript-input.txt', result: 'LONG_REPORT'},
    ]),
  );
  try {
    await writeFile(join(host.directory, 'long-transcript-input.txt'), content);
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        agent: 'reader',
        task: prompt,
        tools: ['read'],
        autoAwait: true,
        notifyPerTask: false,
      }),
    );

    await openTranscript(host, 'reader');
    await host.terminal.screen.waitForText(lastLine, {timeoutMs: 5000});
    const end = await host.terminal.screen.text();
    expect(end).not.toContain('Tool result not recorded.');
    expect(end).not.toContain('Native tool output was truncated');

    await pageToBeginning(host);
    const pages = [await host.terminal.screen.text()];
    for (let index = 0; index < 10; index++)
      pages.push(await pageForwardAndRead(host));
    const transcript = pages.join('\n');
    expect(transcript).toContain(firstLine);
    expect(transcript).not.toContain('Native tool output was truncated');
  } finally {
    await host.close();
  }
}, 60000);
