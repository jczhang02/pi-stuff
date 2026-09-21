import {expect, test} from 'bun:test';
import {mkdir, symlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {Schema} from 'effect';
import {
  launchPi,
  type PiFixtureRequest,
  type PiFixtureResponseCallback,
} from './fixtures/pi-terminal';

const taskMarker = 'READ_CURRENT_CHECKOUT';
const currentFileContent = 'CURRENT_CHECKOUT_UNCOMMITTED_MARKER';

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

test('dispatches read-only work in an installed current project', async () => {
  const childToolSets: string[][] = [];
  let parentCallSent = false;
  let childReadSent = false;
  let childReportSent = false;
  let parentReportSent = false;
  let projectDirectory = '';
  let currentFile = '';
  const observedTools: string[][] = [];
  const responseCallback: PiFixtureResponseCallback = request => {
    const names = toolNames(request);
    observedTools.push(names);
    const text = requestText(request);

    if (!parentCallSent) {
      parentCallSent = true;
      if (!names.includes('subagent')) {
        throw new Error(
          `A02 requires the subagent tool; available tools: ${names.join(', ') || '(none)'}`,
        );
      }
      return {
        type: 'tool_call',
        name: 'subagent',
        arguments: JSON.stringify({
          command: 'dispatch',
          agent: 'reader',
          task: taskMarker,
          cwd: projectDirectory,
          autoAwait: true,
          notifyPerTask: false,
        }),
      };
    }

    if (!childReadSent) {
      if (!text.includes(taskMarker))
        throw new Error('The child model request did not include its task.');
      childReadSent = true;
      childToolSets.push(names);
      if (!names.includes('read'))
        throw new Error('The read-only child did not receive the read tool.');
      return {
        type: 'tool_call',
        name: 'read',
        arguments: JSON.stringify({path: currentFile}),
      };
    }

    if (!childReportSent) {
      childReportSent = true;
      childToolSets.push(names);
      return {
        type: 'content',
        content: `${taskMarker}_REPORT:${text}`,
      };
    }

    if (!parentReportSent) {
      parentReportSent = true;
      return {
        type: 'content',
        content: 'RTK_TURN_1_DONE',
      };
    }

    throw new Error('The fixture received an unexpected model request.');
  };

  const host = await launchPi(
    '{}',
    undefined,
    'subagent',
    'fullscreen',
    responseCallback,
  );
  try {
    projectDirectory = join(host.directory, 'installed-project');
    currentFile = join(projectDirectory, 'CURRENT_CHECKOUT.md');
    await mkdir(projectDirectory);
    await writeFile(
      join(projectDirectory, 'package.json'),
      JSON.stringify({name: 'fixture-installed-project', private: true}),
    );
    await writeFile(currentFile, currentFileContent);
    await symlink(
      resolve('node_modules'),
      join(projectDirectory, 'node_modules'),
    );

    const report = await host.invoke(
      'subagent',
      JSON.stringify({
        command: 'dispatch',
        agent: 'reader',
        task: taskMarker,
        cwd: projectDirectory,
        autoAwait: true,
        notifyPerTask: false,
      }),
    );

    expect(report).toContain(`${taskMarker}_REPORT`);
    expect(report).toContain(currentFileContent);
    expect(childToolSets.length).toBeGreaterThan(0);
    for (const names of childToolSets) {
      expect(names).toContain('read');
      expect(names).not.toContain('subagent');
      expect(names).not.toContain('write');
    }
    expect(observedTools.length).toBeGreaterThan(1);
  } finally {
    await host.close();
  }
}, 60000);
