import {expect, test} from 'bun:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Schema} from 'effect';
import {RunSnapshot} from '../../src/subagent/records';
import {launchPi} from './fixtures/pi-terminal';

// The installed 0.86 host runs asynchronous input hooks during steer. The
// pinned 0.85 host does not, so this is explicit compiled-host acceptance.
for (const scenario of ['ended', 'consumed'] as const) {
  test.skipIf(!process.env.PI_TEST_HOST)(
    `steer observes its own queue insertion when prior execution is ${scenario}`,
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'pi-steer-input-'));
      const extension = join(directory, 'extension.ts');
      await writeFile(
        extension,
        `
import {Type} from 'typebox';
import {access, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export default function(pi) {
  async function gate(cwd, name) {
    await writeFile(join(cwd, name + '-entered'), 'ready');
    while (true) {
      try { await access(join(cwd, name + '-release')); return; }
      catch { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
  }
  pi.registerTool({
    name: 'hold_for_review', label: 'Hold', description: 'Wait for release.',
    parameters: Type.Object({gate: Type.Optional(Type.String())}),
    async execute(_id, params, _signal, _update, ctx) {
      await gate(ctx.cwd, params.gate ?? 'tool');
      return {content: [{type: 'text', text: 'Released'}], details: undefined};
    },
  });
  pi.on('input', async (event, ctx) => {
    if (event.text === 'DELAYED_STEER') await gate(ctx.cwd, 'input');
    return {action: 'continue'};
  });
  pi.on('agent_settled', async (_event, ctx) => {
    if (pi.getActiveTools().includes('ask_parent')) await gate(ctx.cwd, 'settled');
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
          if (scenario === 'consumed' && childCalls === 2)
            return {
              type: 'tool_call',
              name: 'hold_for_review',
              arguments: JSON.stringify({gate: 'second'}),
            };
          return childCalls === 1
            ? {type: 'tool_call', name: 'hold_for_review', arguments: '{}'}
            : {type: 'content', content: 'CHILD_FINISHED_BEFORE_STEER'};
        },
        ['hold_for_review'],
      );
      const decode = Schema.decodeUnknownSync(
        Schema.fromJsonString(RunSnapshot),
      );
      async function entered(name: string) {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          try {
            if (
              (await readFile(
                join(host.directory, name + '-entered'),
                'utf8',
              )) === 'ready'
            )
              return;
          } catch {
            // The producer has not reached this gate yet.
          }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error(`Child never entered ${name}.`);
      }
      async function release(name: string) {
        await writeFile(join(host.directory, name + '-release'), 'release');
      }
      try {
        const run = decode(
          await host.invoke(
            'subagent',
            JSON.stringify({
              command: 'dispatch',
              tasks: [{agent: 'reviewer', task: 'Wait, then report.'}],
              autoAwait: false,
              notifyPerTask: false,
            }),
          ),
        );
        await entered('tool');
        if (scenario === 'consumed') {
          const first = decode(
            await host.invoke(
              'subagent',
              JSON.stringify({
                command: 'steer',
                runId: run.id,
                message: 'FIRST_QUEUED',
              }),
            ),
          );
          expect(first.tasks[0]?.pendingInstructions).toEqual(['FIRST_QUEUED']);
        }
        const steering = host.invoke(
          'subagent',
          JSON.stringify({
            command: 'steer',
            runId: run.id,
            message: 'DELAYED_STEER',
          }),
        );
        await entered('input');
        await release('tool');
        await entered(scenario === 'ended' ? 'settled' : 'second');
        await release('input');
        const receipt = await steering;
        if (scenario === 'ended')
          expect(receipt).toContain('did not queue this instruction');
        else {
          expect(decode(receipt).tasks[0]?.pendingInstructions).toEqual([
            'DELAYED_STEER',
          ]);
          await release('second');
        }
        await release('settled');
        const completed = decode(
          await host.invoke(
            'subagent',
            JSON.stringify({
              command: 'wait',
              runId: run.id,
            }),
          ),
        );
        expect(completed.status).toBe('completed');
        expect(completed.tasks[0]?.pendingInstructions).toEqual([]);
        expect(completed.tasks[0]?.finalText).toBe(
          'CHILD_FINISHED_BEFORE_STEER',
        );
        expect(childCalls).toBe(scenario === 'ended' ? 2 : 3);
      } finally {
        await Promise.all(['tool', 'input', 'settled', 'second'].map(release));
        await host.close();
        await rm(directory, {recursive: true, force: true});
      }
    },
    60000,
  );
}
