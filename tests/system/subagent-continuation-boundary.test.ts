import {expect, test} from 'bun:test';
import {parseSessionEntries} from '@earendil-works/pi-coding-agent';
import {Schema} from 'effect';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  RunSnapshot as RunSnapshotSchema,
  type RunSnapshot,
  type TaskSnapshot,
} from '../../src/subagent/records';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const EXTENSION_SOURCE = (gatePath: string) => `
import {readFileSync} from 'node:fs';
import {Type} from 'typebox';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';

if (readFileSync(${JSON.stringify(gatePath)}, 'utf8').trim() === 'fail')
  throw new Error('BOUNDARY_EXTENSION_GATE');

export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'fixture_counter',
    label: 'Fixture counter',
    description: 'Return a deterministic boundary marker.',
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{type: 'text', text: 'BOUNDARY_TOOL'}],
      details: undefined,
    }),
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

function latestUserText(request: PiFixtureRequest): string {
  return (
    request.messages
      .filter(message => message.role === 'user')
      .map(messageText)
      .at(-1) ?? ''
  );
}

function toolNames(request: PiFixtureRequest): string[] {
  return request.tools?.map(tool => tool.function.name) ?? [];
}

function taskById(run: RunSnapshot, taskId: string): TaskSnapshot {
  const task = run.tasks.find(candidate => candidate.id === taskId);
  if (task === undefined) throw new Error(`Run ${run.id} omitted ${taskId}.`);
  return task;
}

async function sessionSnapshot(file: string) {
  const content = await readFile(file, 'utf8');
  const entries = parseSessionEntries(content);
  return {content, entries, ids: entries.map(entry => entry.id)};
}

test('failed extension reload keeps the old leaf boundary and resumes cleanly', async () => {
  const extensionDirectory = await mkdtemp(
    join(tmpdir(), 'pi-subagent-boundary-extension-'),
  );
  const gatePath = join(extensionDirectory, 'gate');
  const extensionPath = join(extensionDirectory, 'fixture-extension.ts');
  await writeFile(gatePath, 'ok');
  await writeFile(extensionPath, EXTENSION_SOURCE(gatePath));

  const childRequests: PiFixtureRequest[] = [];
  const responseCallback: PiFixtureResponseCallback = request => {
    if (toolNames(request).includes('subagent')) return undefined;
    childRequests.push(request);
    const latest = latestUserText(request);
    if (latest.includes('BOUNDARY_INITIAL')) {
      if (request.messages.at(-1)?.role === 'tool')
        return {
          type: 'content',
          content: 'BOUNDARY_INITIAL_REPORT',
          usage: {input: 7, output: 3},
        };
      return {
        type: 'tool_call',
        name: 'fixture_counter',
        arguments: '{}',
      };
    }
    if (latest.includes('BOUNDARY_CACHE_CLEAR'))
      return {type: 'content', content: 'BOUNDARY_CACHE_CLEAR_REPORT'};
    if (latest.includes('BOUNDARY_FAILED_FOLLOWUP'))
      return {
        type: 'content',
        content: 'UNEXPECTED_FAILED_FOLLOWUP_REPORT',
      };
    if (latest.includes('BOUNDARY_RESUME'))
      return {
        type: 'content',
        content: 'BOUNDARY_RESUME_REPORT',
        usage: {input: 11, output: 5},
      };
    return undefined;
  };

  const host = await launchPi(
    '{}',
    extensionPath,
    'subagent',
    'fullscreen',
    responseCallback,
    ['fixture_counter'],
  );
  try {
    await mkdir(join(host.directory, 'cache-clear'));
    const initialRun = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              id: 'boundary',
              agent: 'boundary',
              task: 'BOUNDARY_INITIAL',
              tools: ['read', 'fixture_counter'],
            },
          ],
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
    expect(initialRun.status).toBe('completed');
    const first = taskById(initialRun, 'boundary');
    expect(first.status).toBe('completed');
    expect(first.finalText).toBe('BOUNDARY_INITIAL_REPORT');
    expect(first.history).toHaveLength(0);
    expect(first.sessionFile).toBeDefined();
    expect(first.sessionId).toBeDefined();
    expect(first.startEntryId).toBeDefined();
    expect(first.endEntryId).toBeDefined();
    expect(first.usage?.input).toBe(7);
    expect(first.usage?.output).toBe(3);

    const sessionFile = first.sessionFile;
    const firstStartEntryId = first.startEntryId;
    const firstEndEntryId = first.endEntryId;
    if (
      sessionFile === undefined ||
      firstStartEntryId === undefined ||
      firstEndEntryId === undefined
    )
      throw new Error('Completed task omitted native session metadata.');
    const beforeFailure = await sessionSnapshot(sessionFile);
    expect(beforeFailure.ids).toContain(firstStartEntryId);
    expect(beforeFailure.ids).toContain(firstEndEntryId);

    // A different child cwd invalidates Pi's process-wide extension factory
    // cache. The next continuation must then evaluate the changed source.
    const cacheRun = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'dispatch',
          tasks: [
            {
              id: 'cache-clear',
              agent: 'cache-clear',
              task: 'BOUNDARY_CACHE_CLEAR',
              cwd: 'cache-clear',
            },
          ],
          autoAwait: true,
          notifyPerTask: false,
        }),
      ),
    );
    expect(cacheRun.status).toBe('completed');
    expect(taskById(cacheRun, 'cache-clear').finalText).toBe(
      'BOUNDARY_CACHE_CLEAR_REPORT',
    );

    await writeFile(gatePath, 'fail');
    const failedRaw = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'follow-up',
        runId: initialRun.id,
        taskId: 'boundary',
        message: 'BOUNDARY_FAILED_FOLLOWUP',
        autoAwait: true,
      }),
    );
    const failedRun = decodeRun(failedRaw);
    expect(failedRun.status).toBe('failed');
    const failed = taskById(failedRun, 'boundary');
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/extension|load|BOUNDARY_EXTENSION_GATE/i);
    expect(failed.requestId).not.toBe(first.requestId);
    expect(failed.finalText).toBe('');
    expect(failed.history).toHaveLength(1);
    expect(failed.history[0]?.requestId).toBe(first.requestId);
    expect(failed.history[0]?.finalText).toBe(first.finalText);
    expect(failed.history[0]?.startEntryId).toBe(firstStartEntryId);
    expect(failed.history[0]?.endEntryId).toBe(firstEndEntryId);
    expect(failed.startEntryId).toBe(firstEndEntryId);
    expect(failed.endEntryId).toBe(firstEndEntryId);
    expect(failed.sessionId).toBe(first.sessionId);
    expect(failed.sessionFile).toBe(first.sessionFile);
    expect(
      childRequests.some(request =>
        latestUserText(request).includes('BOUNDARY_FAILED_FOLLOWUP'),
      ),
    ).toBe(false);
    const afterFailure = await sessionSnapshot(sessionFile);
    expect(afterFailure.content).toBe(beforeFailure.content);
    expect(afterFailure.ids).toEqual(beforeFailure.ids);

    await writeFile(gatePath, 'ok');
    const resumedRun = decodeRun(
      await host.invoke(
        'subagent',
        JSON.stringify({
          command: 'resume',
          runId: initialRun.id,
          taskId: 'boundary',
          message: 'BOUNDARY_RESUME',
          autoAwait: true,
        }),
      ),
    );
    expect(resumedRun.status).toBe('completed');
    const resumed = taskById(resumedRun, 'boundary');
    expect(resumed.status).toBe('completed');
    expect(resumed.finalText).toBe('BOUNDARY_RESUME_REPORT');
    expect(resumed.history).toHaveLength(2);
    expect(resumed.history[0]?.requestId).toBe(first.requestId);
    expect(resumed.history[0]?.finalText).toBe(first.finalText);
    expect(resumed.history[1]?.requestId).toBe(failed.requestId);
    expect(resumed.history[1]?.status).toBe('failed');
    expect(resumed.history[1]?.finalText).toBe('');
    expect(resumed.history[1]?.startEntryId).toBe(firstEndEntryId);
    expect(resumed.history[1]?.endEntryId).toBe(firstEndEntryId);
    expect(resumed.startEntryId).toBeDefined();
    expect(resumed.startEntryId).not.toBe(failed.endEntryId);
    const resumedStartEntryId = resumed.startEntryId;
    const resumedEndEntryId = resumed.endEntryId;
    if (resumedStartEntryId === undefined || resumedEndEntryId === undefined)
      throw new Error('Resumed task omitted native session metadata.');
    expect(resumedEndEntryId).not.toBe(firstEndEntryId);
    expect(resumed.usage?.input).toBe(11);
    expect(resumed.usage?.output).toBe(5);
    expect(resumed.cumulativeUsage?.input).toBe(18);
    expect(resumed.cumulativeUsage?.output).toBe(8);

    const resumeRequest = childRequests.find(request =>
      latestUserText(request).includes('BOUNDARY_RESUME'),
    );
    if (resumeRequest === undefined)
      throw new Error('Missing provider request for resumed continuation.');
    const resumeContext = resumeRequest.messages.map(messageText).join('\n');
    expect(resumeContext).toContain('BOUNDARY_TOOL');
    expect(resumeContext).toContain('BOUNDARY_INITIAL_REPORT');
    expect(resumeContext).toContain('BOUNDARY_RESUME');
    expect(resumeContext).not.toContain('BOUNDARY_FAILED_FOLLOWUP');
    const afterResume = await sessionSnapshot(sessionFile);
    expect(afterResume.ids).toContain(resumedStartEntryId);
    expect(afterResume.ids).toContain(resumedEndEntryId);
    expect(afterResume.ids.length).toBeGreaterThan(beforeFailure.ids.length);
  } finally {
    await writeFile(gatePath, 'ok').catch(() => undefined);
    await host.close();
    await rm(extensionDirectory, {recursive: true, force: true});
  }
}, 60000);
