import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Schema} from 'effect';

const ContentPart = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
});
const ToolCall = Schema.Struct({
  index: Schema.optional(Schema.Number),
  id: Schema.String,
  type: Schema.String,
  function: Schema.Struct({
    name: Schema.String,
    arguments: Schema.String,
  }),
});
const Message = Schema.Struct({
  role: Schema.String,
  content: Schema.optional(
    Schema.Union([Schema.String, Schema.Null, Schema.Array(ContentPart)]),
  ),
  name: Schema.optional(Schema.String),
  tool_call_id: Schema.optional(Schema.String),
  tool_calls: Schema.optional(Schema.Array(ToolCall)),
});
const OfferedTool = Schema.Struct({
  function: Schema.Struct({name: Schema.String}),
});
const Request = Schema.Struct({
  messages: Schema.Array(Message),
  stream: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Array(OfferedTool)),
});
type FixtureRequest = Schema.Schema.Type<typeof Request>;
type FixtureMessage = FixtureRequest['messages'][number];

const StoredTask = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals([
    'queued',
    'starting',
    'running',
    'awaiting_parent',
    'completed',
    'failed',
    'aborted',
  ]),
  sessionId: Schema.optional(Schema.String),
  sessionFile: Schema.optional(Schema.String),
  finalText: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});
const StoredRun = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals([
    'queued',
    'running',
    'awaiting_parent',
    'completed',
    'failed',
    'aborted',
  ]),
  tasks: Schema.Array(StoredTask),
});
const StoredRuns = Schema.Array(StoredRun);
export type SidecarRun = Schema.Schema.Type<typeof StoredRun>;

interface ToolResult {
  name: string;
  text: string;
}

function messageText(message: FixtureMessage | undefined): string {
  const content = message?.content;
  if (Schema.is(Schema.String)(content)) return content;
  if (content === null || content === undefined) return '';
  return content.map(part => part.text ?? '').join('');
}

function userTexts(messages: readonly FixtureMessage[]): string[] {
  return messages
    .filter(message => message.role === 'user')
    .map(message => messageText(message));
}

function lastToolResult(
  messages: readonly FixtureMessage[],
): ToolResult | undefined {
  const last = messages.at(-1);
  if (last?.role !== 'tool') return undefined;
  const assistant = messages
    .slice(0, -1)
    .findLast(message => message.role === 'assistant');
  const id = last.tool_call_id;
  const call = id
    ? assistant?.tool_calls?.find(toolCall => toolCall.id === id)
    : assistant?.tool_calls?.at(-1);
  const name = last.name ?? call?.function.name;
  return name ? {name, text: messageText(last)} : undefined;
}

type Delta =
  | {content: string}
  | {
      tool_calls: {
        index: number;
        id: string;
        type: 'function';
        function: {name: string; arguments: string};
      }[];
    };

function response(deltas: readonly Delta[]): Response {
  const id = `restoration-${Date.now()}`;
  const chunks = deltas.map(delta => ({
    id,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'restoration-fixture',
    choices: [{index: 0, delta, finish_reason: null}],
  }));
  const hasTools = deltas.some(delta => 'tool_calls' in delta);
  const finish = {
    id,
    object: 'chat.completion.chunk',
    model: 'restoration-fixture',
    choices: [
      {index: 0, delta: {}, finish_reason: hasTools ? 'tool_calls' : 'stop'},
    ],
  };
  const body =
    [...chunks, finish]
      .map(chunk => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') +
    `data: ${JSON.stringify({id, object: 'chat.completion.chunk', model: 'restoration-fixture', choices: [], usage: {prompt_tokens: 32, completion_tokens: 8, total_tokens: 40}})}\n\n` +
    'data: [DONE]\n\n';
  return new Response(body, {headers: {'content-type': 'text/event-stream'}});
}

function tool(name: string, args: string, id: string): Delta {
  return {
    tool_calls: [
      {
        index: 0,
        id,
        type: 'function',
        function: {name, arguments: args},
      },
    ],
  };
}

export interface ChildRequest {
  request: FixtureRequest;
}

export async function createSubagentRestorationFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-restoration-'));
  const agentDir = join(directory, 'agent');
  const cwd = join(directory, 'project');
  await mkdir(join(agentDir, 'sessions'), {recursive: true});
  await mkdir(join(cwd, 'src'), {recursive: true});
  await writeFile(join(cwd, 'README.md'), 'restoration fixture project\n');
  await writeFile(
    join(cwd, 'src', 'fixture.ts'),
    'export const fixture = true;\n',
  );

  const childRequests: ChildRequest[] = [];
  const runIds: string[] = [];
  let recoveryRunId: string | undefined;
  let resuming = false;
  let callSequence = 0;

  function nextCallId(): string {
    callSequence++;
    return `restoration_call_${callSequence}`;
  }

  function mainText(text: string): Response {
    return response([{content: text}]);
  }

  function mainTool(name: string, args: string): Response {
    return response([tool(name, args, nextCallId())]);
  }

  function runIdFrom(text: string): string {
    const match = /run_[A-Za-z0-9_-]+/.exec(text);
    if (!match) throw new Error(`fixture could not find run id in: ${text}`);
    const runId = match[0];
    runIds.push(runId);
    recoveryRunId = runId;
    return runId;
  }

  function mainResponse(request: FixtureRequest): Response {
    const called = lastToolResult(request.messages);
    const latest = userTexts(request.messages).at(-1) ?? '';
    if (called?.name === 'subagent')
      return mainTool(
        'await_subagent',
        JSON.stringify({runId: runIdFrom(called.text), timeoutMs: 20_000}),
      );
    if (called?.name === 'resume_subagent')
      return mainTool(
        'await_subagent',
        JSON.stringify({runId: recoveryRunId ?? '', timeoutMs: 20_000}),
      );
    if (called?.name === 'await_subagent')
      return resuming
        ? mainText('RESTORATION_RESUME_DONE')
        : mainText(`RESTORATION_READY:${recoveryRunId ?? ''}`);
    if (latest.includes('restoration resume')) {
      resuming = true;
      return mainTool(
        'resume_subagent',
        JSON.stringify({
          runId: recoveryRunId ?? '',
          taskId: 'task_1',
          message: 'fixture restoration resume',
        }),
      );
    }
    if (latest.includes('restoration parent'))
      return mainText('RESTORATION_PARENT_ALIVE');
    if (latest.includes('restoration create'))
      return mainTool(
        'subagent',
        JSON.stringify({
          agent: 'readonly',
          task: 'fixture restoration readonly',
          notifyPerTask: false,
        }),
      );
    return mainText('RESTORATION_FIXTURE_READY');
  }

  function childResponse(request: FixtureRequest): Response {
    const called = lastToolResult(request.messages);
    const users = userTexts(request.messages);
    if (!called && users.length === 1)
      return mainText('RESTORATION_CHILD_INITIAL');
    if (!called && users.length > 1)
      return response([
        tool(
          'bash',
          JSON.stringify({
            command: `printf restoration-unsafe-write > ${join(cwd, 'restoration-parent-write.txt')}`,
          }),
          nextCallId(),
        ),
      ]);
    if (called?.name === 'bash')
      return mainText('RESTORATION_UNSAFE_WRITE_RAN');
    return mainText('RESTORATION_CHILD_INITIAL');
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST')
        return new Response('not found', {status: 404});
      const decoded = Schema.decodeUnknownSync(Request)(await request.json());
      if (!decoded.stream)
        return Response.json({
          id: 'restoration-probe',
          object: 'chat.completion',
          model: 'restoration-fixture',
          choices: [
            {
              index: 0,
              message: {role: 'assistant', content: 'ready'},
              finish_reason: 'stop',
            },
          ],
        });
      const first = userTexts(decoded.messages)[0] ?? '';
      if (first.includes('fixture restoration readonly')) {
        childRequests.push({request: decoded});
        return childResponse(decoded);
      }
      return mainResponse(decoded);
    },
  });

  await writeFile(
    join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        restoration: {
          baseUrl: `${server.url}v1`,
          api: 'openai-completions',
          apiKey: 'offline-fixture',
          models: [{id: 'restoration-fixture'}],
        },
      },
    }),
  );
  await writeFile(
    join(agentDir, 'settings.json'),
    JSON.stringify({quietStartup: true, retry: {enabled: false}}),
  );

  async function sidecarPath(): Promise<string> {
    const files = await readdir(join(agentDir, 'sessions'), {
      recursive: true,
    });
    const filename = files.find(file =>
      file.endsWith('.pi-stuff-subagents.json'),
    );
    if (!filename) throw new Error('Restoration sidecar was not created.');
    return join(agentDir, 'sessions', filename);
  }

  async function readSidecar(): Promise<SidecarRun[]> {
    const text = await readFile(await sidecarPath(), 'utf8');
    return Array.from(
      Schema.decodeUnknownSync(Schema.fromJsonString(StoredRuns))(text),
    );
  }

  async function waitFor(
    predicate: () => boolean,
    timeout = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await Bun.sleep(25);
    }
    if (!predicate()) throw new Error('Timed out waiting for fixture state.');
  }

  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    await server.stop(true);
    await rm(directory, {recursive: true, force: true});
  }

  return {
    directory,
    agentDir,
    cwd,
    childRequests,
    runIds,
    sidecarPath,
    readSidecar,
    waitFor,
    close,
  };
}
