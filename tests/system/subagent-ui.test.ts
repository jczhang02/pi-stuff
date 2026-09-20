import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';
import {configuredShortcut} from '../../src/subagent/ui/editor';
import {oneLine} from '../../src/subagent/ui/format';

test('named inspect shortcuts preserve valid remaps and reject malformed names', () => {
  expect(configuredShortcut('ctrl+g')).toBe('ctrl+g');
  expect(configuredShortcut('Ctrl+Shift+P')).toBe('ctrl+shift+p');
  expect(configuredShortcut('ctrl+ctrl+g')).toBe('ctrl+r');
  expect(configuredShortcut('not-a-key')).toBe('ctrl+r');
  expect(oneLine('ok\u001b]52;c;clipboard\u0007\u001b[31m text')).toBe(
    'ok text',
  );
});

test('a configured inspect remap opens Fleet and a host collision stays disabled', async () => {
  const remapped = await launchPi(
    '{"subagent":{"inspectShortcut":"ctrl+q"}}',
    undefined,
    'web',
    'fullscreen',
  );
  try {
    await remapped.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    await remapped.terminal.screen.waitForIdle({
      timeoutMs: 5000,
      quietForMs: 300,
    });
    await remapped.terminal.keyboard.press('Control+Q');
    await remapped.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await remapped.terminal.keyboard.type('?');
    await remapped.terminal.screen.waitForText(
      'Main editor inspect binding: ctrl+q',
      {timeoutMs: 5000},
    );
    await remapped.terminal.keyboard.press('Escape');
  } finally {
    await remapped.close();
  }

  const conflict = await launchPi(
    '{"subagent":{"inspectShortcut":"ctrl+g"}}',
    undefined,
    'web',
    'fullscreen',
  );
  try {
    await conflict.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    await conflict.command('/agents fleet');
    await conflict.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    const screen = await conflict.terminal.screen.text();
    expect(screen).toContain('conflicts with');
    expect(screen).toContain('Configure inspectShortcut');
  } finally {
    await conflict.close();
  }
}, 45000);

test('the public agents command opens Fleet, overview and the full reader', async () => {
  const report = `${'FULL_REPORT_MARKER '.repeat(600)}\nDISTANT_REPORT_MARKER\n${'TAIL_REPORT '.repeat(80)}`;
  const host = await launchPi('{}', undefined, 'web', 'fullscreen', request => {
    if (!JSON.stringify(request.messages).includes('SUBAGENT_ASSIGNMENT'))
      return undefined;
    if (request.messages.at(-1)?.role === 'tool')
      return {text: 'child settled'};
    return {
      tool: 'subagent',
      arguments: JSON.stringify({
        command: 'finish',
        outcome: 'fulfilled',
        text: report,
      }),
    };
  });
  try {
    await host.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    const admitted = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {name: 'reader', prompt: 'READER_ASSIGNMENT', workspace: 'live'},
        ],
      }),
    );
    expect(admitted).toContain('"status":"accepted"');
    await host.terminal.screen.waitForText('FULL_REPORT_MARKER', {
      timeoutMs: 15000,
    });
    await host.command('/agents fleet');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    const fleet = await host.terminal.screen.text();
    expect(fleet).toContain('reader');
    expect(fleet).toContain('Done');
    expect(fleet).not.toContain('Running');

    await host.terminal.keyboard.type('o');
    await host.terminal.screen.waitForText('Overview', {timeoutMs: 5000});
    const overview = await host.terminal.screen.text();
    expect(overview).toContain('Dispatch');

    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Actions', {timeoutMs: 5000});
    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Reader', {timeoutMs: 5000});
    await host.terminal.screen.waitForText('FULL_REPORT_MARKER', {
      timeoutMs: 15000,
    });
    await host.terminal.keyboard.type('G');
    await host.terminal.screen.waitForText('DISTANT_REPORT_MARKER', {
      timeoutMs: 5000,
    });
    const endPage = (await host.terminal.screen.text()).match(
      /Lines (\d+)-\d+ of \d+/u,
    );
    expect(endPage).not.toBeNull();
    const endStart = Number(endPage?.[1]);
    await host.terminal.keyboard.type('u');
    await host.terminal.screen.waitUntil(
      screen => {
        const page = screen.text.match(/Lines (\d+)-\d+ of \d+/u);
        return page !== null && Number(page[1]) < endStart;
      },
      {timeoutMs: 5000},
    );
    await host.terminal.keyboard.type('G');
    await host.terminal.screen.waitForText('DISTANT_REPORT_MARKER', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('g');
    await host.terminal.screen.waitForText('FULL_REPORT_MARKER', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('/');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('DISTANT_REPORT_MARKER');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Search: DISTANT_REPORT_MARKER', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('f');
    await host.terminal.screen.waitForText('Following latest output', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('u');
    await host.terminal.screen.waitForText('Reading retained content', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('d');
    await host.terminal.screen.waitForText('Reading retained content', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
  } finally {
    await host.close();
  }
}, 45000);

test('overview keeps real dependency edges in a left-to-right graph', async () => {
  const host = await launchPi('{}', undefined, 'web', 'fullscreen', request => {
    const messages = JSON.stringify(request.messages);
    if (
      !messages.includes('GRAPH_SOURCE') &&
      !messages.includes('GRAPH_TARGET')
    )
      return undefined;
    if (request.messages.at(-1)?.role === 'tool')
      return {text: 'graph assignment settled'};
    return {
      tool: 'subagent',
      arguments: JSON.stringify({
        command: 'finish',
        outcome: 'fulfilled',
        text: 'graph result',
      }),
    };
  });
  try {
    await host.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            key: 'source',
            name: 'source',
            prompt: 'GRAPH_SOURCE',
            workspace: 'live',
          },
          {
            key: 'target',
            name: 'target',
            prompt: 'GRAPH_TARGET',
            needs: ['source'],
            workspace: 'live',
          },
        ],
      }),
    );
    await host.command('/agents');
    await host.terminal.screen.waitForText('dependency graph', {
      timeoutMs: 5000,
    });
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('L0');
    expect(screen).toContain('L1');
    expect(screen).toMatch(/▶|�/u);
    expect(screen).toContain('Edges 1');
    expect(screen).not.toContain('source → target');
  } finally {
    await host.close();
  }
}, 45000);

test('browsing keeps targeted editor letters and stop back navigation local', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const host = await launchPi(
    '{}',
    undefined,
    'web',
    'fullscreen',
    async request => {
      if (!JSON.stringify(request.messages).includes('ACTIVE_ASSIGNMENT'))
        return undefined;
      started.resolve();
      await release.promise;
      return {text: 'held child output'};
    },
  );
  try {
    const admitted = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {name: 'active', prompt: 'ACTIVE_ASSIGNMENT', workspace: 'live'},
        ],
      }),
    );
    expect(admitted).toContain('"status":"accepted"');
    await started.promise;
    // SAFETY: the fixture command accepts JSON and the assertion only reads its documented task agentId.
    const admittedResult = JSON.parse(admitted) as {
      tasks: readonly {agentId: string}[];
    };
    const agentId = admittedResult.tasks[0]?.agentId;
    expect(agentId).toBeString();
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'followup',
        agentId,
        text: 'QUEUED_FOLLOWUP',
      }),
    );
    await host.command('/agents fleet');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.screen.waitForText('active', {timeoutMs: 5000});
    const queuedFleet = await host.terminal.screen.text();
    // The compact row reserves independent status and token columns, so the
    // long prompt is intentionally clipped at the terminal width.
    expect(queuedFleet).toContain('ACTIVE_ASSIGNMEN');
    expect(queuedFleet).not.toContain('QUEUED_FOLLOWUP');
    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Actions', {timeoutMs: 5000});
    await host.terminal.keyboard.type('jjj');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('jkq?');
    await host.terminal.screen.waitForText('jkq?', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Actions', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.screen.waitForText('jkq?', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Actions', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Actions', {timeoutMs: 5000});
    await host.terminal.keyboard.type('jjjjj');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Stop branch', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
  } finally {
    release.resolve();
    await host.close();
  }
}, 45000);

test('overview escape restores the host editor so Ctrl+D still exits Pi', async () => {
  const host = await launchPi('{}', undefined, 'web', 'fullscreen');
  try {
    await host.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    await host.command('/agents');
    await host.terminal.screen.waitForText('Agents / Overview', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      async screen => !screen.text.includes('Agents / Overview'),
      {timeoutMs: 5000},
    );
    await host.terminal.keyboard.press('Control+D');
    const exited = await host.terminal.waitForExit({timeoutMs: 5000});
    expect(exited.reason).toBe('exited');
  } finally {
    await host.close();
  }
}, 30000);
