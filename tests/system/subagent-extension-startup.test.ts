import {expect, test} from 'bun:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Schema} from 'effect';
import {RunSnapshot} from '../../src/subagent/records';
import {launchPi} from './fixtures/pi-terminal';

test('required extension load and binding failures stop the child before model execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-child-startup-'));
  const extension = join(directory, 'extension.ts');
  await writeFile(
    extension,
    `
import {Type} from 'typebox';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
export default function(pi) {
  if (existsSync(join(import.meta.dirname, 'fail-load'))) throw new Error('CHILD_FACTORY_FAILURE');
  pi.registerTool({
    name: 'startup_probe', label: 'Startup probe', description: 'Check startup.',
    parameters: Type.Object({}),
    async execute() { return {content: [{type: 'text', text: 'ready'}], details: undefined}; },
  });
  pi.on('session_start', async (_event, ctx) => {
    if (ctx.sessionManager.getHeader()?.parentSession !== undefined)
      await ctx.ui.input('Unsupported child startup interaction');
  });
}
`,
  );
  let childCalls = 0;
  const host = await launchPi(
    '{}',
    extension,
    'subagent',
    'fullscreen',
    request => {
      if (request.tools?.some(tool => tool.function.name === 'subagent'))
        return undefined;
      childCalls++;
      return {type: 'content', content: 'Unexpected model execution'};
    },
    ['startup_probe'],
  );
  const decode = Schema.decodeUnknownSync(Schema.fromJsonString(RunSnapshot));
  async function dispatch() {
    return decode(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [{agent: 'reviewer', task: 'Inspect startup.'}],
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
  }
  try {
    await writeFile(join(directory, 'fail-load'), 'fail');
    const failedLoad = await dispatch();
    expect(failedLoad.status).toBe('failed');
    expect(failedLoad.tasks[0]?.error).toContain('CHILD_FACTORY_FAILURE');
    expect(failedLoad.tasks[0]?.error).toContain(extension);
    expect(childCalls).toBe(0);
    await rm(join(directory, 'fail-load'));
    const failedBind = await dispatch();
    expect(failedBind.status).toBe('failed');
    expect(failedBind.tasks[0]?.error).toContain('failed to bind');
    expect(failedBind.tasks[0]?.error).toContain(
      'Interactive UI is not supported in subagents',
    );
    expect(failedBind.tasks[0]?.error).toContain(extension);
    expect(childCalls).toBe(0);
  } finally {
    await host.close();
    await rm(directory, {recursive: true, force: true});
  }
}, 60000);
