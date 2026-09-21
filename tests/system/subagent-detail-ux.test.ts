import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

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

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

function expectPanelBorder(text: string, title: string, width: number): void {
  const lines = text.split('\n');
  const titleIndex = lines.findIndex(line => line.includes(title));
  expect(titleIndex).toBeGreaterThan(0);
  expect(lines[titleIndex - 1]?.trim()).toBe('─'.repeat(width));
}

async function openChildDetail(
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

async function waitForReplyComposerClosed(
  host: Awaited<ReturnType<typeof launchPi>>,
  agent: string,
): Promise<void> {
  await host.terminal.screen.waitUntil(
    snapshot => !snapshot.text.includes(`Reply ${agent}`),
    {timeoutMs: 5000},
  );
}

function childReportCallback(
  report: string,
  toolPath: string,
): PiFixtureResponseCallback {
  let issued = false;
  return request => {
    if (request.tools?.some(tool => tool.function.name === 'subagent'))
      return undefined;
    if (!issued) {
      issued = true;
      return {
        type: 'tool_call',
        name: 'read',
        arguments: JSON.stringify({path: toolPath}),
      };
    }
    return {type: 'content', content: report};
  };
}

test('80-column detail exposes activity before a long report and keeps the main draft', async () => {
  const report = Array.from(
    {length: 20},
    (_, index) =>
      `LONG_DETAIL_REPORT_${String(index).padStart(2, '0')} Retained output remains available for review.`,
  ).join('\n\n');
  const toolPath = 'detail-activity-evidence.txt';
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    childReportCallback(report, toolPath),
  );
  try {
    await writeFile(
      join(host.directory, toolPath),
      Array.from(
        {length: 40},
        (_, index) => `DETAIL_ACTIVITY_NATIVE_RESULT_${index}`,
      ).join('\n'),
    );
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        agent: 'long-report-reader',
        task: 'Inspect the retained long report',
        tools: ['read'],
        autoAwait: true,
        notifyPerTask: false,
      }),
    );
    await host.terminal.keyboard.type('DETAIL_MAIN_DRAFT');
    await openChildDetail(host, 'long-report-reader');

    await host.terminal.resize({cols: 80, rows: 24});
    await host.terminal.screen.waitUntil(
      snapshot => snapshot.frame.cols === 80 && snapshot.frame.rows === 24,
      {timeoutMs: 5000},
    );
    const narrow = await host.terminal.screen.text();
    expectPanelBorder(narrow, 'long-report-reader · Done', 80);
    expect(
      countOccurrences(narrow, 'LONG_DETAIL_REPORT_'),
    ).toBeGreaterThanOrEqual(5);

    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText(toolPath, {timeoutMs: 5000});
    const activityFirst = await host.terminal.screen.text();
    const activityIndex = activityFirst.indexOf(toolPath);
    expect(activityIndex).toBeGreaterThanOrEqual(0);
    expect(activityFirst.indexOf('▾ Activity')).toBeLessThan(activityIndex);

    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● long-report-reader', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      snapshot =>
        snapshot.text.includes('DETAIL_MAIN_DRAFT') &&
        !snapshot.text.includes('esc back'),
      {timeoutMs: 5000},
    );
  } finally {
    await host.close();
  }
}, 60000);

test('dependency graph and supporting readers start below a panel boundary', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request =>
      request.tools?.some(tool => tool.function.name === 'subagent')
        ? undefined
        : {type: 'content', content: 'PANEL_BOUNDARY_REPORT'},
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {id: 'boundary-source', agent: 'boundary-source', task: 'Source'},
          {
            id: 'boundary-review',
            agent: 'boundary-review',
            task: 'Review',
            needs: ['boundary-source'],
          },
        ],
        autoAwait: true,
        notifyPerTask: false,
      }),
    );
    await openChildDetail(host, 'boundary-source');
    await host.terminal.keyboard.type('i');
    await host.terminal.screen.waitForText('boundary-source · Info', {
      timeoutMs: 5000,
    });
    expectPanelBorder(
      await host.terminal.screen.text(),
      'boundary-source · Info',
      100,
    );
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('t');
    await host.terminal.screen.waitForText('boundary-source · Transcript', {
      timeoutMs: 5000,
    });
    expectPanelBorder(
      await host.terminal.screen.text(),
      'boundary-source · Transcript',
      100,
    );
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('▸ Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● boundary-source', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('g');
    await host.terminal.screen.waitForText('Dependencies ·', {
      timeoutMs: 5000,
    });
    expectPanelBorder(await host.terminal.screen.text(), 'Dependencies ·', 100);
  } finally {
    await host.close();
  }
}, 60000);

test('expanded prompt does not duplicate the assignment and preserves the main draft', async () => {
  const assignment = 'PROMPT_ASSIGNMENT_UNIQUE_TEXT';
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request =>
      request.tools?.some(tool => tool.function.name === 'subagent')
        ? undefined
        : {type: 'content', content: 'PROMPT_DEDUP_REPORT'},
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        agent: 'prompt-reader',
        task: assignment,
        autoAwait: true,
        notifyPerTask: false,
      }),
    );
    await host.terminal.keyboard.type('PROMPT_MAIN_DRAFT');
    await openChildDetail(host, 'prompt-reader');
    await host.terminal.keyboard.type('p');
    await host.terminal.screen.waitForText(assignment, {timeoutMs: 5000});
    const expanded = await host.terminal.screen.text();
    expect(countOccurrences(expanded, assignment)).toBe(1);

    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● prompt-reader', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      snapshot =>
        snapshot.text.includes('PROMPT_MAIN_DRAFT') &&
        !snapshot.text.includes('esc back'),
      {timeoutMs: 5000},
    );
  } finally {
    await host.close();
  }
}, 60000);

test('reply composer renders a pending question once and keeps its draft', async () => {
  const taskMarker = 'QUESTION_DEDUP_TASK';
  const question = 'QUESTION_DEDUP_TEXT: which file should I inspect?';
  const responseCallback: PiFixtureResponseCallback = request => {
    if (request.tools?.some(tool => tool.function.name === 'subagent'))
      return undefined;
    const latest = latestUserText(request);
    const lastMessage = request.messages.at(-1);
    if (latest.includes(taskMarker) && lastMessage?.role !== 'tool')
      return {
        type: 'tool_call',
        name: 'ask_parent',
        arguments: JSON.stringify({question}),
      };
    return {type: 'content', content: 'QUESTION_DEDUP_REPORT'};
  };
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    responseCallback,
  );
  try {
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        agent: 'question-reader',
        task: taskMarker,
        autoAwait: true,
        notifyPerTask: false,
      }),
    );
    await host.terminal.keyboard.type('QUESTION_MAIN_DRAFT');
    await openChildDetail(host, 'question-reader');
    await host.terminal.screen.waitForText(question, {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Reply question-reader', {
      timeoutMs: 5000,
    });
    const composer = await host.terminal.screen.text();
    expect(countOccurrences(composer, question)).toBe(1);

    await host.terminal.keyboard.type('QUESTION_REPLY_DRAFT');
    await host.terminal.keyboard.press('Escape');
    await waitForReplyComposerClosed(host, 'question-reader');
    await host.terminal.screen.waitForText(question, {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('QUESTION_REPLY_DRAFT', {
      timeoutMs: 5000,
    });
    expect(countOccurrences(await host.terminal.screen.text(), question)).toBe(
      1,
    );

    await host.terminal.keyboard.press('Escape');
    await waitForReplyComposerClosed(host, 'question-reader');
    await host.terminal.screen.waitForText(question, {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('● question-reader', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      snapshot =>
        snapshot.text.includes('QUESTION_MAIN_DRAFT') &&
        !snapshot.text.includes('esc back'),
      {timeoutMs: 5000},
    );
  } finally {
    await host.close();
  }
}, 60000);
