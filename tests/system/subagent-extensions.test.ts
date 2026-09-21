import {expect, test} from 'bun:test';
import {Schema} from 'effect';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  RunSnapshot as RunSnapshotSchema,
  type RunSnapshot,
} from '../../src/subagent/records';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const COUNTER_EXTENSION = `
import {Type} from 'typebox';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';

export default function(pi: ExtensionAPI) {
  let counter = 0;
  pi.registerTool({
    name: 'fixture_counter',
    label: 'Fixture counter',
    description: 'Return the mutable counter for this extension factory.',
    parameters: Type.Object({}),
    execute: async (_id, _params, _signal, _onUpdate, ctx) => {
      counter += 1;
      const scope = ctx.sessionManager.getHeader()?.parentSession === undefined
        ? 'parent'
        : 'child';
      return {
        content: [{type: 'text', text: 'COUNTER:' + counter + ':' + scope}],
        details: undefined,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0.125,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0.125,
          },
        },
      };
    },
  });
}
`;

const NARROWING_EXTENSION = `
import {Type} from 'typebox';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';

export default function(pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    if (ctx.sessionManager.getHeader()?.parentSession !== undefined)
      pi.setActiveTools([
        ...pi.getActiveTools(),
        'fixture_counter',
        'fixture_hidden',
      ]);
  });
  pi.registerTool({
    name: 'fixture_counter',
    label: 'Fixture counter',
    description: 'A compatible extension tool.',
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{type: 'text', text: 'COUNTER_TOOL'}],
      details: undefined,
    }),
  });
  pi.registerTool({
    name: 'fixture_hidden',
    label: 'Fixture hidden',
    description: 'A tool that must not be enabled by a child extension.',
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{type: 'text', text: 'HIDDEN_TOOL'}],
      details: undefined,
    }),
  });
}
`;

const UI_EXTENSION = `
import {Type} from 'typebox';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';

export default function(pi: ExtensionAPI) {
  pi.on('before_agent_start', async (event, ctx) => {
    if (event.prompt.includes('EXT_HOOK_UI')) await ctx.ui.input('hook');
  });
  pi.registerTool({
    name: 'fixture_ui_input',
    label: 'Fixture UI input',
    description: 'Request interactive input from a child.',
    parameters: Type.Object({}),
    execute: async (_id, _params, _signal, _onUpdate, ctx) => {
      const value = await ctx.ui.input('tool');
      return {
        content: [{type: 'text', text: 'UI_VALUE:' + (value ?? 'undefined')}],
        details: undefined,
      };
    },
  });
}
`;

const decodeRun = Schema.decodeUnknownSync(
  Schema.fromJsonString(RunSnapshotSchema),
);

function messageText(message: PiFixtureRequest['messages'][number]): string {
  const content = message.content;
  if (content === undefined || content === null) return '';
  if (Schema.is(Schema.String)(content)) return content;
  return content.map(block => block.text ?? '').join('');
}

function requestText(request: PiFixtureRequest): string {
  return request.messages.map(messageText).join('\n');
}

function toolNames(request: PiFixtureRequest): string[] {
  return request.tools?.map(tool => tool.function.name) ?? [];
}

type ChildRequest = Readonly<{
  marker: string;
  names: string[];
  afterTool: boolean;
}>;

function extensionCallback(
  markers: readonly string[],
  childRequests: ChildRequest[],
): PiFixtureResponseCallback {
  return request => {
    const names = toolNames(request);
    if (names.includes('subagent')) return undefined;
    const text = requestText(request);
    const marker = markers.find(candidate => text.includes(candidate));
    if (marker === undefined) return undefined;
    const afterTool = request.messages.at(-1)?.role === 'tool';
    childRequests.push({marker, names, afterTool});
    if (afterTool)
      return {
        type: 'content',
        content: `COUNTER_REPORT:${marker}:${text}`,
      };
    return {type: 'tool_call', name: 'fixture_counter', arguments: '{}'};
  };
}

function taskById(run: RunSnapshot, id: string): RunSnapshot['tasks'][number] {
  const task = run.tasks.find(candidate => candidate.id === id);
  if (task === undefined) throw new Error(`Run ${run.id} omitted task ${id}.`);
  return task;
}

async function writeExtension(source: string): Promise<{
  directory: string;
  path: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-extension-'));
  const path = join(directory, 'fixture-extension.ts');
  await writeFile(path, source);
  return {directory, path};
}

async function writeNarrowingRole(directory: string): Promise<void> {
  const roles = join(directory, '.agents', 'agents');
  await mkdir(roles, {recursive: true});
  await writeFile(
    join(roles, 'extension-role.md'),
    [
      '---',
      'description: extension role narrowing',
      'tools: read, fixture_counter',
      '---',
      'Use the compatible extension counter.',
      '',
    ].join('\n'),
  );
}

test('default children inherit a fresh extension factory without delegation', async () => {
  const extension = await writeExtension(COUNTER_EXTENSION);
  const childRequests: ChildRequest[] = [];
  const host = await launchPi(
    '{}',
    extension.path,
    'subagent',
    'fullscreen',
    extensionCallback(['EXT_COUNTER_ONE', 'EXT_COUNTER_TWO'], childRequests),
    ['fixture_counter'],
  );
  try {
    const run = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {id: 'one', agent: 'one', task: 'EXT_COUNTER_ONE'},
            {id: 'two', agent: 'two', task: 'EXT_COUNTER_TWO'},
          ],
          concurrency: 2,
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
    expect(run.status).toBe('completed');
    const one = taskById(run, 'one');
    const two = taskById(run, 'two');
    expect(one.finalText).toContain('COUNTER:1:child');
    expect(two.finalText).toContain('COUNTER:1:child');
    expect(one.usage?.cost).toBe(0.125);
    expect(two.usage?.cost).toBe(0.125);
    expect(one.cumulativeUsage?.cost).toBe(0.125);
    expect(two.cumulativeUsage?.cost).toBe(0.125);
    expect(one.usage?.input).toBeUndefined();
    expect(one.usage?.output).toBeUndefined();
    expect(two.usage?.input).toBeUndefined();
    expect(two.usage?.output).toBeUndefined();

    const initialRequests = childRequests.filter(request => !request.afterTool);
    expect(initialRequests).toHaveLength(2);
    for (const request of childRequests)
      expect(request.names).not.toContain('subagent');
    for (const marker of ['EXT_COUNTER_ONE', 'EXT_COUNTER_TWO']) {
      const request = initialRequests.find(
        candidate => candidate.marker === marker,
      );
      if (request === undefined)
        throw new Error(`Missing child request for ${marker}.`);
      expect(request.names).toContain('fixture_counter');
      expect(request.names).toContain('ask_parent');
    }
  } finally {
    await host.close();
    await rm(extension.directory, {recursive: true, force: true});
  }
}, 60000);

test('explicit tools and roles narrow extension tools despite child setActiveTools', async () => {
  const extension = await writeExtension(NARROWING_EXTENSION);
  const childRequests: ChildRequest[] = [];
  const host = await launchPi(
    '{}',
    extension.path,
    'subagent',
    'fullscreen',
    request => {
      const names = toolNames(request);
      if (names.includes('subagent')) return undefined;
      const text = requestText(request);
      const marker = ['EXT_EXPLICIT_NARROW', 'EXT_ROLE_NARROW'].find(
        candidate => text.includes(candidate),
      );
      if (marker === undefined) return undefined;
      childRequests.push({
        marker,
        names,
        afterTool: request.messages.at(-1)?.role === 'tool',
      });
      return {type: 'content', content: `NARROW_REPORT:${marker}`};
    },
    ['fixture_counter', 'fixture_hidden'],
  );
  try {
    await writeNarrowingRole(host.directory);
    const run = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              id: 'explicit',
              agent: 'explicit',
              task: 'EXT_EXPLICIT_NARROW',
              tools: ['read'],
            },
            {
              id: 'role',
              agent: 'extension-role',
              task: 'EXT_ROLE_NARROW extension role narrowing',
            },
          ],
          concurrency: 1,
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
    expect(run.status).toBe('completed');
    expect(taskById(run, 'explicit').finalText).toContain(
      'NARROW_REPORT:EXT_EXPLICIT_NARROW',
    );
    expect(taskById(run, 'role').finalText).toContain(
      'NARROW_REPORT:EXT_ROLE_NARROW',
    );
    for (const request of childRequests) {
      expect(request.names).not.toContain('subagent');
      expect(request.names).not.toContain('fixture_hidden');
    }
    const explicit = childRequests.find(
      request => request.marker === 'EXT_EXPLICIT_NARROW',
    );
    const role = childRequests.find(
      request => request.marker === 'EXT_ROLE_NARROW',
    );
    if (explicit === undefined || role === undefined)
      throw new Error('Missing narrowed child request.');
    expect(explicit.names).not.toContain('fixture_counter');
    expect(role.names).toContain('fixture_counter');
  } finally {
    await host.close();
    await rm(extension.directory, {recursive: true, force: true});
  }
}, 60000);

test('child tool and runtime hook UI errors remain explicit', async () => {
  const extension = await writeExtension(UI_EXTENSION);
  const childRequests: ChildRequest[] = [];
  const host = await launchPi(
    '{}',
    extension.path,
    'subagent',
    'fullscreen',
    request => {
      const names = toolNames(request);
      if (names.includes('subagent')) return undefined;
      const text = requestText(request);
      const marker = ['EXT_TOOL_UI', 'EXT_HOOK_UI'].find(candidate =>
        text.includes(candidate),
      );
      if (marker === undefined) return undefined;
      const afterTool = request.messages.at(-1)?.role === 'tool';
      childRequests.push({marker, names, afterTool});
      if (marker === 'EXT_TOOL_UI') {
        if (afterTool)
          return {
            type: 'content',
            content: `UI_TOOL_REPORT:${text}`,
          };
        return {type: 'tool_call', name: 'fixture_ui_input', arguments: '{}'};
      }
      return {type: 'content', content: `UI_HOOK_REPORT:${text}`};
    },
    ['fixture_ui_input'],
  );
  try {
    const run = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {id: 'tool-ui', agent: 'tool-ui', task: 'EXT_TOOL_UI'},
            {id: 'hook-ui', agent: 'hook-ui', task: 'EXT_HOOK_UI'},
          ],
          concurrency: 1,
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
    expect(run.status).toBe('completed');
    const toolTask = taskById(run, 'tool-ui');
    const hookTask = taskById(run, 'hook-ui');
    expect(toolTask.status).toBe('completed');
    expect(toolTask.finalText).toContain('Interactive UI is not supported');
    expect(toolTask.finalText).toContain('Use ask_parent instead.');
    expect(hookTask.status).toBe('completed');
    const extensionErrors = hookTask.extensionErrors;
    if (extensionErrors === undefined)
      throw new Error('The hook UI failure was not recorded.');
    expect(extensionErrors.join('\n')).toContain('before_agent_start');
    expect(extensionErrors.join('\n')).toContain(
      'Interactive UI is not supported in subagents',
    );
    for (const request of childRequests)
      expect(request.names).not.toContain('subagent');
  } finally {
    await host.close();
    await rm(extension.directory, {recursive: true, force: true});
  }
}, 60000);
