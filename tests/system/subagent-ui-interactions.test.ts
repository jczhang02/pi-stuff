import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';

const Admission = Schema.Struct({
  tasks: Schema.Array(
    Schema.Struct({taskId: Schema.String, agentId: Schema.String}),
  ),
});

const Inspection = Schema.Struct({
  tasks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      agentId: Schema.String,
      phase: Schema.Literals([
        'queued',
        'starting',
        'executing',
        'waiting',
        'cancelling',
        'ended',
        'unknown',
      ]),
      outcome: Schema.NullOr(
        Schema.Literals([
          'fulfilled',
          'unable',
          'incomplete',
          'failed',
          'cancelled',
          'skipped',
          'interrupted',
        ]),
      ),
    }),
  ),
  messages: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.Literals([
        'message',
        'steer',
        'question',
        'reply',
        'report',
      ]),
      fromTaskId: Schema.NullOr(Schema.String),
      taskId: Schema.NullOr(Schema.String),
      questionId: Schema.NullOr(Schema.String),
      text: Schema.String,
      consumedAt: Schema.NullOr(Schema.Number),
    }),
  ),
});

const decodeAdmission = (value: string) =>
  Schema.decodeUnknownSync(Admission)(JSON.parse(value));
const decodeInspection = (value: string) =>
  Schema.decodeUnknownSync(Inspection)(JSON.parse(value));

type PiHost = Awaited<ReturnType<typeof launchPi>>;

async function visibleActionLines(host: PiHost): Promise<string[]> {
  return (await host.terminal.screen.text())
    .split('\n')
    .filter(line => line.includes('● ') || line.includes('○ '));
}

async function selectVisibleAction(host: PiHost, label: string): Promise<void> {
  const lines = await visibleActionLines(host);
  const current = lines.findIndex(line => line.includes('● '));
  const target = lines.findIndex(line => line.includes(label));
  expect(target).toBeGreaterThanOrEqual(0);
  expect(current).toBeGreaterThanOrEqual(0);
  if (target > current)
    await host.terminal.keyboard.type('j'.repeat(target - current));
  else if (target < current)
    await host.terminal.keyboard.type('k'.repeat(current - target));
  await host.terminal.keyboard.press('Enter');
}

test('busy main keeps native multiline editing and inspect shortcut out of the draft', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let busyRequests = 0;
  const host = await launchPi(
    '{"subagent":{"inspectShortcut":"ctrl+q"}}',
    undefined,
    'web',
    'fullscreen',
    async request => {
      if (!JSON.stringify(request.messages).includes('BUSY_MAIN_PROMPT'))
        return undefined;
      if (busyRequests++ === 0) {
        started.resolve();
        await release.promise;
        return {text: 'main request settled'};
      }
      return {text: 'draft delivered'};
    },
  );
  try {
    await host.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    await host.terminal.screen.waitForIdle({
      timeoutMs: 10000,
      quietForMs: 1000,
    });
    for (const byte of new TextEncoder().encode('/mo'))
      await host.terminal.keyboard.write(Uint8Array.of(byte));
    await new Promise(resolve => setTimeout(resolve, 500));
    await host.terminal.screen.waitForText('→ model', {timeoutMs: 5000});
    expect(await host.terminal.screen.text()).toContain('Select model');
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForIdle({
      timeoutMs: 5000,
      quietForMs: 200,
    });
    await host.terminal.keyboard.press('Backspace');
    await host.terminal.keyboard.press('Backspace');
    await host.terminal.keyboard.press('Backspace');
    await host.terminal.screen.waitUntil(
      screen => !screen.text.includes('/mo'),
      {timeoutMs: 5000},
    );
    await host.terminal.keyboard.type('MAIN_LINE_ONE');
    await host.terminal.keyboard.press('Control+J');
    await host.terminal.keyboard.type('MAIN_LINE_TWO');
    await host.terminal.keyboard.press('ArrowLeft');
    await host.terminal.keyboard.type('X');
    await host.terminal.screen.waitForText('MAIN_LINE_TWXO', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.write(Uint8Array.of(0x1f));
    await host.terminal.screen.waitUntil(
      screen =>
        screen.text.includes('MAIN_LINE_TWO') &&
        !screen.text.includes('MAIN_LINE_TWXO'),
      {timeoutMs: 5000},
    );
    await host.terminal.keyboard.press('Control+U');
    await host.terminal.keyboard.press('Backspace');
    await host.terminal.keyboard.press('Control+U');
    await host.terminal.keyboard.type('BUSY_MAIN_PROMPT');
    await host.terminal.keyboard.press('Enter');
    await started.promise;
    await host.terminal.keyboard.type('BUSY_DRAFT_LINE_ONE');
    await host.terminal.keyboard.press('Control+J');
    await host.terminal.keyboard.type('BUSY_DRAFT_LINE_TWO');
    await host.terminal.keyboard.press('ArrowLeft');
    await host.terminal.keyboard.type('X');
    await host.terminal.screen.waitForText('BUSY_DRAFT_LINE_TWXO', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Control+Q');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    const fleet = await host.terminal.screen.text();
    expect(fleet).toContain('Fleet');
    expect(fleet).not.toContain('Targeted action');
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitUntil(
      screen => screen.text.includes('BUSY_DRAFT_LINE_TWXO'),
      {timeoutMs: 5000},
    );
    await host.terminal.keyboard.write(Uint8Array.of(0x1f));
    await host.terminal.screen.waitUntil(
      screen =>
        screen.text.includes('BUSY_DRAFT_LINE_TWO') &&
        !screen.text.includes('BUSY_DRAFT_LINE_TWXO'),
      {timeoutMs: 5000},
    );
    await host.terminal.keyboard.type('Y');
    await host.terminal.screen.waitForText('BUSY_DRAFT_LINE_TWYO', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.write(Uint8Array.of(0x1f));
    await host.terminal.screen.waitUntil(
      screen =>
        screen.text.includes('BUSY_DRAFT_LINE_TWO') &&
        !screen.text.includes('BUSY_DRAFT_LINE_TWYO'),
      {timeoutMs: 5000},
    );
    release.resolve();
    await host.terminal.screen.waitForText('main request settled', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Control+Q');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.keyboard.press('Escape');
  } finally {
    release.resolve();
    await host.close();
  }
}, 30000);

test('pending child questions keep message and steer targeted to the child assignment', async () => {
  const asked = Promise.withResolvers<void>();
  let askObserved = false;
  const host = await launchPi(
    '{"subagent":{"inspectShortcut":"ctrl+q"}}',
    undefined,
    'subagent',
    'fullscreen',
    async request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      if (!history.includes('QUESTION_ASSIGNMENT')) return undefined;
      if (history.includes('ANSWER_PENDING')) {
        if (request.messages.at(-1)?.role === 'tool')
          return {text: 'question answered'};
        return {
          tool: 'subagent',
          arguments: JSON.stringify({
            command: 'finish',
            outcome: 'fulfilled',
            text: 'question answered',
          }),
        };
      }
      if (!askObserved) {
        askObserved = true;
        asked.resolve();
      }
      return {
        tool: 'subagent',
        arguments: JSON.stringify({
          command: 'ask',
          text: 'Which child field should I use?',
          timeoutMs: 60000,
        }),
      };
    },
  );
  try {
    const leaveInspection = async () => {
      await host.terminal.keyboard.press('Escape');
      await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
      await host.terminal.keyboard.press('Escape');
      await host.terminal.screen.waitUntil(
        screen => !screen.text.includes('Fleet'),
        {timeoutMs: 5000},
      );
    };
    const openChildDetail = async () => {
      await host.command('/agents fleet');
      await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
      await host.terminal.screen.waitForText('question-child', {
        timeoutMs: 5000,
      });
      await host.terminal.keyboard.type('j');
      await host.terminal.keyboard.press('Enter');
      await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    };
    await host.terminal.screen.waitForText('Pi can explain', {
      timeoutMs: 15000,
    });
    const admitted = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {
            name: 'question-child',
            prompt: 'QUESTION_ASSIGNMENT',
            workspace: 'live',
          },
        ],
      }),
    );
    expect(admitted).toContain('accepted');
    const childTaskId = decodeAdmission(admitted).tasks[0]?.taskId;
    expect(childTaskId).toBeString();
    await asked.promise;
    await host.terminal.screen.waitForIdle({timeoutMs: 5000, quietForMs: 300});
    const pending = await host.invoke('subagent', '{"command":"inspect"}');
    const pendingRecord = decodeInspection(pending);
    const question = pendingRecord.messages.find(
      message => message.kind === 'question',
    );
    expect(question?.text).toBe('Which child field should I use?');
    expect(question?.fromTaskId).toBe(childTaskId);
    expect(question?.taskId).toBeNull();
    expect(question?.consumedAt).toBeNull();

    await host.terminal.screen.waitForIdle({timeoutMs: 5000, quietForMs: 300});
    await host.terminal.keyboard.press('Control+Q');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.screen.waitForText('question-child', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('k');
    await host.terminal.keyboard.type('j');
    const browse = await host.terminal.screen.text();
    expect(browse).toContain('Fleet');
    expect(browse).not.toContain('Targeted action');
    await host.terminal.screen.waitForIdle({timeoutMs: 5000, quietForMs: 200});
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Agents / question-child', {
      timeoutMs: 5000,
    });

    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Actions', {timeoutMs: 5000});
    await selectVisibleAction(host, 'Message assignment');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('MESSAGE_PENDING_CHILD');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText(
      'message accepted for question-child',
      {timeoutMs: 5000},
    );
    await host.terminal.screen.waitForText('Agents / question-child', {
      timeoutMs: 5000,
    });
    await leaveInspection();
    const afterMessage = decodeInspection(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(
      afterMessage.messages.some(
        message =>
          message.kind === 'message' &&
          message.taskId === childTaskId &&
          message.text === 'MESSAGE_PENDING_CHILD',
      ),
    ).toBe(true);

    await openChildDetail();
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Actions', {timeoutMs: 5000});
    await selectVisibleAction(host, 'Steer active assignment');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('STEER_PENDING_CHILD');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText(
      'steer accepted for question-child',
      {timeoutMs: 5000},
    );
    await host.terminal.screen.waitForText('Agents / question-child', {
      timeoutMs: 5000,
    });
    await leaveInspection();
    const afterSteer = decodeInspection(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    expect(
      afterSteer.messages.some(
        message =>
          message.kind === 'steer' &&
          message.taskId === childTaskId &&
          message.text === 'STEER_PENDING_CHILD',
      ),
    ).toBe(true);

    await openChildDetail();
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Actions', {timeoutMs: 5000});
    await selectVisibleAction(host, 'Reply to pending question');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('ANSWER_PENDING');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText(
      'Reply accepted for question-child',
      {timeoutMs: 5000},
    );
    await host.terminal.screen.waitForText('Agents / question-child', {
      timeoutMs: 5000,
    });
  } finally {
    await host.close();
  }
}, 30000);

test('waiting question actions refresh in place and deduplicate attention', async () => {
  const asked = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  let askedOnce = false;
  let finishRequested = false;
  const host = await launchPi(
    '{"subagent":{"answerWaitMs":3000}}',
    undefined,
    'subagent',
    'fullscreen',
    async request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('MENU_REFRESH_ASSIGNMENT')) return undefined;
      const latest = JSON.stringify(request.messages.at(-1)?.content);
      if (latest.includes('expired')) {
        finishRequested = true;
        finished.resolve();
        return {
          tool: 'subagent',
          arguments: JSON.stringify({
            command: 'finish',
            outcome: 'fulfilled',
            text: 'MENU_REFRESH_FINISHED',
          }),
        };
      }
      if (finishRequested) return {text: 'MENU_REFRESH_FINISHED'};
      if (!askedOnce) {
        askedOnce = true;
        asked.resolve();
      }
      return {
        tool: 'subagent',
        arguments: JSON.stringify({
          command: 'ask',
          text: 'MENU_REFRESH_QUESTION',
          timeoutMs: 10000,
        }),
      };
    },
  );
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
            name: 'menu-refresh-child',
            prompt: 'MENU_REFRESH_ASSIGNMENT',
            workspace: 'live',
          },
        ],
      }),
    );
    await asked.promise;
    await host.terminal.screen.waitForIdle({timeoutMs: 5000, quietForMs: 300});
    await host.terminal.resize({cols: 80, rows: 12});

    await host.command('/agents fleet');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.screen.waitForText('menu-refresh-chi', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('1 attention');
    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Agents / menu-refresh-child', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Actions', {timeoutMs: 5000});
    const waitingActions = await visibleActionLines(host);
    expect(waitingActions[0]).toContain('Reply to pending question');
    expect(waitingActions.some(line => line.includes('Queue controls'))).toBe(
      false,
    );

    await host.terminal.keyboard.type('d');
    await host.terminal.screen.waitUntil(
      screen => !screen.text.includes('● Reply to pending question'),
      {timeoutMs: 5000},
    );
    await host.terminal.keyboard.type('g');
    await host.terminal.screen.waitForText('● Reply to pending question', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('G');
    await host.terminal.screen.waitForText('● Stop owned branch', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('u');
    await host.terminal.screen.waitUntil(
      screen => !screen.text.includes('● Stop owned branch'),
      {timeoutMs: 5000},
    );
    await host.terminal.keyboard.type('G');
    await host.terminal.screen.waitForText('● Stop owned branch', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Stop branch', {timeoutMs: 5000});
    await host.terminal.keyboard.type('q');
    await host.terminal.screen.waitForText('Agents / menu-refresh-child', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Agents / Actions', {
      timeoutMs: 5000,
    });

    await finished.promise;
    await host.terminal.screen.waitForText('Follow up with retained context', {
      timeoutMs: 5000,
    });
    const finishedActions = await visibleActionLines(host);
    expect(finishedActions[0]).toContain('Follow up with retained context');
    expect(
      finishedActions.some(line => line.includes('Reply to pending question')),
    ).toBe(false);
    expect(
      finishedActions.some(line => line.includes('Steer active assignment')),
    ).toBe(false);
    expect(
      finishedActions.some(line => line.includes('Stop owned branch')),
    ).toBe(false);
    expect(finishedActions.some(line => line.includes('Queue controls'))).toBe(
      false,
    );

    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Agents / menu-refresh-child', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.press('Escape');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    const finishedFleet = await host.terminal.screen.text();
    expect(finishedFleet).toContain('Done');
    expect(finishedFleet).not.toContain('attention');
  } finally {
    await host.close();
  }
}, 30000);

test('failed recovery submission keeps the draft after workspace release', async () => {
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('FAILED_FOLLOWUP_ASSIGNMENT')) return undefined;
      const latestUser = [...request.messages]
        .reverse()
        .find(message => message.role === 'user');
      const latestUserText = JSON.stringify(latestUser?.content) ?? '';
      if (latestUserText.includes('Run RTK turn')) return undefined;
      if (request.messages.at(-1)?.role === 'tool')
        return {text: 'child settled'};
      return {
        tool: 'subagent',
        arguments: JSON.stringify({
          command: 'finish',
          outcome: 'fulfilled',
          text: 'ended before follow-up',
        }),
      };
    },
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
          {
            name: 'released-child',
            prompt: 'FAILED_FOLLOWUP_ASSIGNMENT',
            workspace: 'live',
          },
        ],
      }),
    );
    const {tasks} = decodeAdmission(admitted);
    const taskId = tasks[0]?.taskId;
    const agentId = tasks[0]?.agentId;
    expect(taskId).toBeString();
    expect(agentId).toBeString();
    let inspection = decodeInspection(
      await host.invoke('subagent', '{"command":"inspect"}'),
    );
    for (let attempt = 0; attempt < 10; attempt++) {
      if (inspection.tasks.find(task => task.id === taskId)?.phase === 'ended')
        break;
      await new Promise(resolve => setTimeout(resolve, 100));
      inspection = decodeInspection(
        await host.invoke('subagent', '{"command":"inspect"}'),
      );
    }
    expect(inspection.tasks.find(task => task.id === taskId)?.phase).toBe(
      'ended',
    );
    const released = await host.invoke(
      'subagent',
      JSON.stringify({command: 'release', agentId}),
    );
    expect(released).toContain('released');

    await host.command('/agents fleet');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.screen.waitForText('released-child', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Actions', {timeoutMs: 5000});
    const actions = (await host.terminal.screen.text())
      .split('\n')
      .filter(line => line.includes('● ') || line.includes('○ '));
    const recoveryIndex = actions.findIndex(line =>
      line.includes('Recover held or unknown queue'),
    );
    expect(recoveryIndex).toBe(0);
    expect(
      actions.some(line => line.includes('Follow up with retained context')),
    ).toBe(false);
    await selectVisibleAction(host, 'Recover held or unknown queue');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('FAILED_FOLLOWUP_DRAFT');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('followup failed', {
      timeoutMs: 5000,
    });
    const failed = await host.terminal.screen.text();
    expect(failed).toContain('FAILED_FOLLOWUP_DRAFT');
    expect(failed).toContain('Targeted action');
  } finally {
    await host.close();
  }
}, 30000);

test('late steer retains its draft and requires explicit follow-up conversion', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const ended = Promise.withResolvers<void>();
  let requestCount = 0;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    async request => {
      if (!JSON.stringify(request.messages).includes('LATE_STEER_ASSIGNMENT'))
        return undefined;
      if (requestCount++ === 0) {
        started.resolve();
        await release.promise;
        ended.resolve();
        return {text: 'late child completed'};
      }
      return {text: 'follow-up completed'};
    },
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
          {
            name: 'late-child',
            prompt: 'LATE_STEER_ASSIGNMENT',
            workspace: 'live',
          },
        ],
      }),
    );
    expect(admitted).toContain('accepted');
    await started.promise;

    await host.command('/agents fleet');
    await host.terminal.screen.waitForText('Fleet', {timeoutMs: 5000});
    await host.terminal.screen.waitForText('late-child', {timeoutMs: 5000});
    await host.terminal.keyboard.type('j');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('Prompt', {timeoutMs: 5000});
    await host.terminal.keyboard.type('a');
    await host.terminal.screen.waitForText('Actions', {timeoutMs: 5000});
    const actions = (await host.terminal.screen.text())
      .split('\n')
      .filter(line => line.includes('● ') || line.includes('○ '));
    const steerIndex = actions.findIndex(line =>
      line.includes('Steer active assignment'),
    );
    expect(steerIndex).toBeGreaterThanOrEqual(0);
    await selectVisibleAction(host, 'Steer active assignment');
    await host.terminal.screen.waitForText('Targeted action', {
      timeoutMs: 5000,
    });
    await host.terminal.keyboard.type('LATE_STEER_DRAFT');
    await host.terminal.screen.waitForText('LATE_STEER_DRAFT', {
      timeoutMs: 5000,
    });

    release.resolve();
    await ended.promise;
    await host.terminal.screen.waitForIdle({
      timeoutMs: 5000,
      quietForMs: 300,
    });
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText(
      'This assignment ended while the draft was being edited',
      {timeoutMs: 5000},
    );
    const late = await host.terminal.screen.text();
    expect(late).toContain('Draft retained: LATE_STEER_DRAFT');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('followup · late-child', {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('LATE_STEER_DRAFT');
  } finally {
    release.resolve();
    await host.close();
  }
}, 30000);
