import {expect, test} from 'bun:test';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';

const Admission = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({taskId: Schema.String, agentId: Schema.String}),
    ),
  }),
);

test('parent history is opt-in and its unresolved dispatch call becomes a labelled fork control', async () => {
  let freshSawParent = false;
  let copiedSawParent = false;
  let copiedSawControl = false;
  const host = await launchPi('{}', undefined, 'web', 'fullscreen', request => {
    const history = JSON.stringify(request.messages);
    if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
    if (request.messages.at(-1)?.role === 'tool') return {text: 'Delivered.'};
    const user = JSON.stringify(
      request.messages.filter(message => message.role === 'user').at(-1)
        ?.content,
    );
    if (user.includes('FRESH_CONTEXT'))
      freshSawParent = history.includes('PARENT_SHARED_CONTEXT');
    if (user.includes('COPIED_CONTEXT')) {
      copiedSawParent = history.includes('PARENT_SHARED_CONTEXT');
      copiedSawControl = history.includes('[Fork control]');
    }
    return {
      tool: 'subagent',
      arguments:
        '{"command":"finish","outcome":"fulfilled","text":"Context checked."}',
    };
  });
  try {
    await host.terminal.keyboard.type('PARENT_SHARED_CONTEXT');
    await host.terminal.keyboard.press('Enter');
    await host.terminal.screen.waitForText('RTK_TURN_0_DONE', {
      timeoutMs: 5000,
    });
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {name: 'fresh', prompt: 'FRESH_CONTEXT', workspace: 'live'},
          {
            name: 'copied',
            prompt: 'COPIED_CONTEXT',
            workspace: 'live',
            copyHistory: true,
          },
        ],
      }),
    );
    await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');
    const result = await host.invoke(
      'subagent',
      '{"command":"wait","timeoutMs":5000}',
    );
    expect(result).toContain('Context checked.');
    expect(freshSawParent).toBe(false);
    expect(copiedSawParent).toBe(true);
    expect(copiedSawControl).toBe(true);
  } finally {
    await host.close();
  }
}, 30000);

test('explicit roles freeze instructions for follow-up and unknown tools reject the complete batch', async () => {
  let usedSavedInstructions = false;
  let usedOverride = false;
  const host = await launchPi('{}', undefined, 'web', 'fullscreen', request => {
    const history = JSON.stringify(request.messages);
    if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
    if (request.messages.at(-1)?.role === 'tool') return {text: 'Delivered.'};
    const user = JSON.stringify(
      request.messages.filter(message => message.role === 'user').at(-1)
        ?.content,
    );
    if (user.includes('SAVED_ROLE_FOLLOWUP'))
      usedSavedInstructions =
        history.includes('ORIGINAL_ROLE_POLICY') &&
        !history.includes('CHANGED_ROLE_POLICY');
    if (user.includes('OVERRIDDEN_ROLE_FOLLOWUP'))
      usedOverride = history.includes('EXPLICIT_OVERRIDE_POLICY');
    return {
      tool: 'subagent',
      arguments:
        '{"command":"finish","outcome":"fulfilled","text":"Role reviewed."}',
    };
  });
  try {
    const roles = join(host.directory, '.pi', 'agents');
    await mkdir(roles, {recursive: true});
    const role = join(roles, 'reviewer.md');
    await writeFile(
      role,
      '---\nname: reviewer\ndescription: Review behavior\ntools: subagent\nworkspace: live\n---\nORIGINAL_ROLE_POLICY\n',
    );
    expect(await host.invoke('subagent', '{"command":"roles"}')).toContain(
      'reviewer',
    );
    const invalid = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        tasks: [
          {name: 'valid', prompt: 'Do not start', role: 'reviewer'},
          {
            name: 'invalid',
            prompt: 'Unknown tool',
            tools: ['subagent', 'unsafe-global-tool'],
          },
        ],
      }),
    );
    expect(invalid).toContain('"status":"rejected"');
    expect(await host.invoke('subagent', '{"command":"inspect"}')).toContain(
      '"tasks":[]',
    );
    const initial = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {name: 'reviewer', prompt: 'FIRST_ROLE_REVIEW', role: 'reviewer'},
          ],
        }),
      ),
    );
    await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');
    await writeFile(
      role,
      '---\nname: reviewer\ndescription: Changed role\ntools: unsafe-global-tool\n---\nCHANGED_ROLE_POLICY\n',
    );
    const agentId = initial.tasks[0]?.agentId;
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId,
          text: 'SAVED_ROLE_FOLLOWUP',
        }),
      ),
    ).toContain('"status":"accepted"');
    await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');
    expect(usedSavedInstructions).toBe(true);
    expect(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'followup',
          agentId,
          text: 'OVERRIDDEN_ROLE_FOLLOWUP',
          overrides: {instructions: 'EXPLICIT_OVERRIDE_POLICY'},
        }),
      ),
    ).toContain('"status":"accepted"');
    await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');
    expect(usedOverride).toBe(true);
  } finally {
    await host.close();
  }
}, 30000);

test('explicit non-Git cwd loads its local rules and skills without parent-directory rules', async () => {
  let context = '';
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      const history = JSON.stringify(request.messages);
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      context = history;
      if (request.messages.at(-1)?.role === 'tool') return {text: 'Done.'};
      return {
        tool: 'subagent',
        arguments:
          '{"command":"finish","outcome":"fulfilled","text":"Resources inspected."}',
      };
    },
  );
  try {
    const cwd = join(host.directory, 'documents');
    const skill = join(cwd, '.pi', 'skills', 'local-check');
    await mkdir(skill, {recursive: true});
    await writeFile(
      join(host.directory, 'AGENTS.md'),
      'PARENT_DIRECTORY_RULES_MUST_NOT_LEAK\n',
    );
    await writeFile(join(cwd, 'AGENTS.md'), 'NON_GIT_PROJECT_RULES\n');
    await writeFile(
      join(skill, 'SKILL.md'),
      '---\nname: local-check\ndescription: NON_GIT_LOCAL_SKILL\n---\nCheck local document consistency.\n',
    );
    const admission = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'documents',
              prompt: 'CHECK_LOCAL_RESOURCES',
              cwd,
              workspace: 'live',
            },
          ],
        }),
      ),
    );
    const settled = await host.invoke(
      'subagent',
      '{"command":"wait","timeoutMs":5000}',
    );
    expect(settled).toContain('Resources inspected.');
    expect(context).toContain('NON_GIT_PROJECT_RULES');
    expect(context).toContain('NON_GIT_LOCAL_SKILL');
    expect(context).not.toContain('PARENT_DIRECTORY_RULES_MUST_NOT_LEAK');
    const transcript = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'read',
        taskId: admission.tasks[0]?.taskId,
        record: 'transcript',
        length: 16000,
      }),
    );
    expect(transcript).toContain(`Rules: ${join(cwd, 'AGENTS.md')}`);
    expect(transcript).toContain(
      `Skills available: ${join(skill, 'SKILL.md')}`,
    );
    expect(transcript).toContain(
      '8 shared execution slots; 64 tasks per dispatch; maximum depth 3',
    );
  } finally {
    await host.close();
  }
}, 30000);

test('copied history retains an actual Pi compaction summary and excludes later parent tool results', async () => {
  let compactionSawRead = false;
  let childSawSummary = false;
  let followupSawLaterParent = false;
  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    request => {
      const history = JSON.stringify(request.messages);
      if (
        history.includes('Create a structured context checkpoint summary') ||
        history.includes('This is the PREFIX of a turn')
      ) {
        compactionSawRead = history.includes('BEFORE_COMPACTION_FACT');
        return {text: 'COMPACTION_SAVED_FACT: BEFORE_COMPACTION_FACT'};
      }
      if (!history.includes('SUBAGENT_ASSIGNMENT')) return undefined;
      childSawSummary ||= history.includes('COMPACTION_SAVED_FACT');
      if (history.includes('AFTER_COMPACTION_FOLLOWUP'))
        followupSawLaterParent ||= history.includes('LATER_PARENT_TOOL_FACT');
      if (request.messages.at(-1)?.role === 'tool') return {text: 'Delivered.'};
      return {
        tool: 'subagent',
        arguments:
          '{"command":"finish","outcome":"fulfilled","text":"Compacted context retained."}',
      };
    },
  );
  try {
    await writeFile(
      join(host.agent, 'settings.json'),
      JSON.stringify({compaction: {keepRecentTokens: 1}}),
    );
    await host.reload();
    await writeFile(
      join(host.directory, 'before.txt'),
      'BEFORE_COMPACTION_FACT\n',
    );
    await host.invoke('read', '{"path":"before.txt"}');
    await host.command('/compact');
    try {
      await host.terminal.screen.waitForText('Compacted from', {
        timeoutMs: 10000,
      });
    } catch (error) {
      console.error(await host.terminal.screen.text());
      console.error(await host.terminal.logs.text());
      throw error;
    }
    const admission = Schema.decodeUnknownSync(Admission)(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              name: 'copied',
              prompt: 'READ_COMPACTION_CONTEXT',
              workspace: 'live',
              copyHistory: true,
            },
          ],
        }),
      ),
    );
    await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');
    expect(compactionSawRead).toBe(true);
    expect(childSawSummary).toBe(true);
    await writeFile(
      join(host.directory, 'later.txt'),
      'LATER_PARENT_TOOL_FACT\n',
    );
    await host.invoke('read', '{"path":"later.txt"}');
    await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'followup',
        agentId: admission.tasks[0]?.agentId,
        text: 'AFTER_COMPACTION_FOLLOWUP',
      }),
    );
    await host.invoke('subagent', '{"command":"wait","timeoutMs":5000}');
    expect(followupSawLaterParent).toBe(false);
  } finally {
    await host.close();
  }
}, 30000);
