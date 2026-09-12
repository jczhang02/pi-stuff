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
export type FixtureRequest = Schema.Schema.Type<typeof Request>;
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

export type MechanismScenario =
  | 'timeout'
  | 'cancel-queued'
  | 'dependencies'
  | 'ask'
  | 'resume'
  | 'sibling'
  | 'scoped-cancel';

export type ChildRole =
  | 'timeout'
  | 'cancel-first'
  | 'cancel-second'
  | 'cancel-third'
  | 'chain-source'
  | 'chain-consumer'
  | 'needs-source'
  | 'needs-dependent'
  | 'needs-failed'
  | 'needs-blocked'
  | 'asker'
  | 'resume-completed'
  | 'resume-failed'
  | 'sibling-a'
  | 'sibling-b'
  | 'scoped-keep'
  | 'scoped-cancel';

export interface ChildRequest {
  role: ChildRole;
  request: FixtureRequest;
  at: number;
}

interface ToolResult {
  name: string;
  text: string;
}

interface FixtureState {
  scenario: MechanismScenario;
  dependencyPhase: 'chain' | 'explicit';
  chainRunId: string | undefined;
  explicitRunId: string | undefined;
  resumeKind: 'completed' | 'failed' | undefined;
  resumePhase: 'initial' | 'resuming';
  activeResumeRunId: string | undefined;
  completedRunId: string | undefined;
  failedRunId: string | undefined;
  scopedRunId: string | undefined;
  awaitStartedAt: number | undefined;
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

export function messageText(message: FixtureMessage | undefined): string {
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

function response(deltas: readonly Delta[]): Response {
  const id = `mechanism-${Date.now()}`;
  const chunks = deltas.map(delta => ({
    id,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'mechanism-fixture',
    choices: [{index: 0, delta, finish_reason: null}],
  }));
  const hasTools = deltas.some(delta => 'tool_calls' in delta);
  const finish = {
    id,
    object: 'chat.completion.chunk',
    model: 'mechanism-fixture',
    choices: [
      {index: 0, delta: {}, finish_reason: hasTools ? 'tool_calls' : 'stop'},
    ],
  };
  const body =
    [...chunks, finish]
      .map(chunk => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') +
    `data: ${JSON.stringify({id, object: 'chat.completion.chunk', model: 'mechanism-fixture', choices: [], usage: {prompt_tokens: 32, completion_tokens: 8, total_tokens: 40}})}\n\n` +
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

function failure(): Response {
  return Response.json(
    {
      error: {
        message: 'mechanism fixture controlled HTTP failure',
        type: 'server_error',
      },
    },
    {status: 500},
  );
}

function childRole(first: string): ChildRole | undefined {
  const roles: [string, ChildRole][] = [
    ['fixture wall clock timeout', 'timeout'],
    ['fixture cancel first child', 'cancel-first'],
    ['fixture cancel queued second child', 'cancel-second'],
    ['fixture cancel queued third child', 'cancel-third'],
    ['fixture chain source', 'chain-source'],
    ['fixture chain consumer', 'chain-consumer'],
    ['fixture dependency source', 'needs-source'],
    ['fixture dependency dependent', 'needs-dependent'],
    ['fixture dependency failed', 'needs-failed'],
    ['fixture dependency blocked', 'needs-blocked'],
    ['fixture ask child', 'asker'],
    ['fixture resume completed', 'resume-completed'],
    ['fixture resume failed', 'resume-failed'],
    ['fixture sibling a', 'sibling-a'],
    ['fixture sibling b', 'sibling-b'],
    ['fixture scoped keep', 'scoped-keep'],
    ['fixture scoped cancel', 'scoped-cancel'],
  ];
  return roles.find(([marker]) => first.includes(marker))?.[1];
}

export async function createSubagentMechanismFixture(
  scenario: MechanismScenario,
) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagent-mechanisms-'));
  const agentDir = join(directory, 'agent');
  const cwd = join(directory, 'project');
  await mkdir(join(agentDir, 'sessions'), {recursive: true});
  await mkdir(join(cwd, 'src'), {recursive: true});
  await writeFile(join(cwd, 'README.md'), 'mechanism fixture project\n');
  await writeFile(
    join(cwd, 'src', 'fixture.ts'),
    'export const fixture = true;\n',
  );

  const requests: FixtureRequest[] = [];
  const childRequests: ChildRequest[] = [];
  const mainActions: string[] = [];
  const awaitDurations: number[] = [];
  const runIds: string[] = [];
  const httpFailures: string[] = [];
  const answers: string[] = [];
  const state: FixtureState = {
    scenario,
    dependencyPhase: 'chain',
    chainRunId: undefined,
    explicitRunId: undefined,
    resumeKind: undefined,
    resumePhase: 'initial',
    activeResumeRunId: undefined,
    completedRunId: undefined,
    failedRunId: undefined,
    scopedRunId: undefined,
    awaitStartedAt: undefined,
  };
  let callSequence = 0;

  function nextCallId(): string {
    callSequence++;
    return `mechanism_call_${callSequence}`;
  }

  function runIdFrom(text: string): string {
    const match = /run_[A-Za-z0-9_-]+/.exec(text);
    if (!match) throw new Error(`fixture could not find run id in: ${text}`);
    const runId = match[0];
    runIds.push(runId);
    return runId;
  }

  function mainTool(name: string, args: string): Response {
    mainActions.push(name);
    if (name === 'await_subagent') state.awaitStartedAt = Date.now();
    return response([tool(name, args, nextCallId())]);
  }

  function mainText(text: string): Response {
    return response([{content: text}]);
  }

  function subagent(args: string): Response {
    return mainTool('subagent', args);
  }

  function awaitSubagent(runId: string): Response {
    return mainTool(
      'await_subagent',
      JSON.stringify({runId, timeoutMs: 20_000}),
    );
  }

  function childTask(taskId: string, agent: string, task: string) {
    return {id: taskId, agent, task};
  }

  function mainResponse(request: FixtureRequest): Response {
    const called = lastToolResult(request.messages);
    const latest = userTexts(request.messages).at(-1) ?? '';
    if (
      called?.name === 'await_subagent' &&
      state.awaitStartedAt !== undefined
    ) {
      awaitDurations.push(Date.now() - state.awaitStartedAt);
      state.awaitStartedAt = undefined;
    }

    if (scenario === 'timeout') {
      if (called?.name === 'subagent')
        return awaitSubagent(runIdFrom(called.text));
      if (called?.name === 'await_subagent')
        return mainText('MECHANISM_TIMEOUT_DONE');
      if (latest.includes('mechanism timeout'))
        return subagent(
          JSON.stringify({
            agent: 'timeout',
            task: 'fixture wall clock timeout',
            maxRuntimeMs: 1000,
            notifyPerTask: false,
          }),
        );
      return mainText('MECHANISM_FIXTURE_READY');
    }

    if (scenario === 'cancel-queued') {
      if (called?.name === 'subagent') {
        const runId = runIdFrom(called.text);
        return mainTool('subagent_cancel', JSON.stringify({runId}));
      }
      if (called?.name === 'subagent_cancel')
        return mainText(`MECHANISM_CANCEL_QUEUED_DONE:${runIds.at(-1) ?? ''}`);
      if (latest.includes('mechanism cancel queued'))
        return subagent(
          JSON.stringify({
            tasks: [
              childTask('first', 'cancel-first', 'fixture cancel first child'),
              childTask(
                'second',
                'cancel-second',
                'fixture cancel queued second child',
              ),
              childTask(
                'third',
                'cancel-third',
                'fixture cancel queued third child',
              ),
            ],
            concurrency: 1,
            notifyPerTask: false,
          }),
        );
      return mainText('MECHANISM_FIXTURE_READY');
    }

    if (scenario === 'dependencies') {
      if (called?.name === 'subagent') {
        const runId = runIdFrom(called.text);
        if (state.dependencyPhase === 'chain') state.chainRunId = runId;
        else state.explicitRunId = runId;
        return awaitSubagent(runId);
      }
      if (called?.name === 'await_subagent') {
        return state.dependencyPhase === 'chain'
          ? mainText(`MECHANISM_CHAIN_DONE:${state.chainRunId ?? ''}`)
          : mainText(`MECHANISM_NEEDS_DONE:${state.explicitRunId ?? ''}`);
      }
      if (
        state.dependencyPhase === 'chain' &&
        state.chainRunId &&
        latest.includes('mechanism dependency explicit')
      ) {
        state.dependencyPhase = 'explicit';
        return subagent(
          JSON.stringify({
            tasks: [
              childTask('source', 'needs-source', 'fixture dependency source'),
              {
                ...childTask(
                  'dependent',
                  'needs-dependent',
                  'fixture dependency dependent',
                ),
                needs: ['source'],
              },
              childTask('failed', 'needs-failed', 'fixture dependency failed'),
              {
                ...childTask(
                  'blocked',
                  'needs-blocked',
                  'fixture dependency blocked',
                ),
                needs: ['failed'],
              },
            ],
            concurrency: 2,
            notifyPerTask: false,
          }),
        );
      }
      if (latest.includes('mechanism dependency chain') && !state.chainRunId)
        return subagent(
          JSON.stringify({
            chain: [
              childTask('source', 'chain-source', 'fixture chain source'),
              {
                ...childTask(
                  'consumer',
                  'chain-consumer',
                  'fixture chain consumer uses {previous}',
                ),
              },
            ],
            concurrency: 1,
            notifyPerTask: false,
          }),
        );
      return mainText('MECHANISM_FIXTURE_READY');
    }

    if (scenario === 'ask') {
      if (called?.name === 'subagent') {
        const runId = runIdFrom(called.text);
        return awaitSubagent(runId);
      }
      if (called?.name === 'await_subagent') {
        const runId = runIds.at(-1) ?? '';
        if (mainActions.filter(name => name === 'await_subagent').length === 1)
          return mainTool(
            'reply_subagent',
            JSON.stringify({
              runId,
              taskId: 'task_1',
              message: 'fixture answer: continue the assigned check',
            }),
          );
        return mainText(`MECHANISM_ASK_DONE:${runId}`);
      }
      if (called?.name === 'reply_subagent')
        return awaitSubagent(runIds.at(-1) ?? '');
      if (latest.includes('mechanism ask'))
        return subagent(
          JSON.stringify({
            agent: 'asker',
            task: 'fixture ask child',
            notifyPerTask: false,
          }),
        );
      return mainText('MECHANISM_FIXTURE_READY');
    }

    if (scenario === 'resume') {
      if (called?.name === 'subagent') {
        const runId = runIdFrom(called.text);
        state.activeResumeRunId = runId;
        if (state.resumeKind === 'completed') state.completedRunId = runId;
        else state.failedRunId = runId;
        return awaitSubagent(runId);
      }
      if (called?.name === 'await_subagent') {
        const runId = state.activeResumeRunId ?? '';
        if (state.resumePhase === 'initial')
          return mainText(
            `MECHANISM_RESUME_READY_${state.resumeKind}:${runId}`,
          );
        return mainText(`MECHANISM_RESUMED_${state.resumeKind}:${runId}`);
      }
      if (called?.name === 'resume_subagent')
        return awaitSubagent(state.activeResumeRunId ?? '');
      if (latest.includes('mechanism resume completed now')) {
        state.resumeKind = 'completed';
        state.resumePhase = 'resuming';
        return mainTool(
          'resume_subagent',
          JSON.stringify({
            runId: state.completedRunId ?? '',
            taskId: 'task_1',
            message: 'fixture resume completed follow-up',
          }),
        );
      }
      if (latest.includes('mechanism resume failed now')) {
        state.resumeKind = 'failed';
        state.resumePhase = 'resuming';
        return mainTool(
          'resume_subagent',
          JSON.stringify({
            runId: state.failedRunId ?? '',
            taskId: 'task_1',
            message: 'fixture resume failed follow-up',
          }),
        );
      }
      if (latest.includes('mechanism resume failed')) {
        state.resumeKind = 'failed';
        state.resumePhase = 'initial';
        return subagent(
          JSON.stringify({
            agent: 'failed',
            task: 'fixture resume failed',
            notifyPerTask: false,
          }),
        );
      }
      if (latest.includes('mechanism resume completed')) {
        state.resumeKind = 'completed';
        state.resumePhase = 'initial';
        return subagent(
          JSON.stringify({
            agent: 'completed',
            task: 'fixture resume completed',
            notifyPerTask: false,
          }),
        );
      }
      return mainText('MECHANISM_FIXTURE_READY');
    }

    if (scenario === 'sibling') {
      if (called?.name === 'subagent')
        return awaitSubagent(runIdFrom(called.text));
      if (called?.name === 'await_subagent')
        return mainText(`MECHANISM_SIBLING_DONE:${runIds.at(-1) ?? ''}`);
      if (latest.includes('mechanism sibling'))
        return subagent(
          JSON.stringify({
            tasks: [
              childTask('sibling-a', 'sibling-a', 'fixture sibling a'),
              childTask('sibling-b', 'sibling-b', 'fixture sibling b'),
            ],
            concurrency: 1,
            notifyPerTask: false,
          }),
        );
      return mainText('MECHANISM_FIXTURE_READY');
    }

    if (called?.name === 'subagent') {
      const runId = runIdFrom(called.text);
      state.scopedRunId = runId;
      return awaitSubagent(runId);
    }
    if (called?.name === 'await_subagent')
      return mainTool(
        'subagent_cancel',
        JSON.stringify({runId: state.scopedRunId ?? '', taskId: 'cancelled'}),
      );
    if (called?.name === 'subagent_cancel')
      return mainTool(
        'subagent_status',
        JSON.stringify({runId: state.scopedRunId ?? ''}),
      );
    if (called?.name === 'subagent_status')
      return mainText(
        `MECHANISM_SCOPED_CANCEL_DONE:${state.scopedRunId ?? ''}`,
      );
    if (latest.includes('mechanism scoped followup'))
      return mainText('MECHANISM_SCOPED_MAIN_ALIVE');
    if (latest.includes('mechanism scoped cancel'))
      return subagent(
        JSON.stringify({
          tasks: [
            childTask('keep', 'scoped-keep', 'fixture scoped keep'),
            childTask('cancelled', 'scoped-cancel', 'fixture scoped cancel'),
          ],
          concurrency: 2,
          notifyPerTask: false,
        }),
      );
    return mainText('MECHANISM_FIXTURE_READY');
  }

  function requestCount(role: ChildRole): number {
    return childRequests.filter(request => request.role === role).length;
  }

  function holdUntilAbort(signal: AbortSignal): Promise<Response> {
    return new Promise(resolveResponse => {
      const finish = () => {
        signal.removeEventListener('abort', finish);
        resolveResponse(new Response('fixture request aborted', {status: 499}));
      };
      if (signal.aborted) finish();
      else signal.addEventListener('abort', finish, {once: true});
    });
  }

  async function childResponse(
    role: ChildRole,
    request: FixtureRequest,
    signal: AbortSignal,
  ): Promise<Response> {
    const called = lastToolResult(request.messages);
    const users = userTexts(request.messages);
    const latest = users.at(-1) ?? '';
    if (
      role === 'cancel-first' ||
      role === 'scoped-cancel' ||
      role === 'timeout'
    )
      return holdUntilAbort(signal);
    if (
      role === 'needs-failed' ||
      (role === 'resume-failed' && requestCount(role) === 1)
    ) {
      httpFailures.push(role);
      return failure();
    }
    if (role === 'chain-source' && !called)
      return response([{content: 'CHAIN_SOURCE_OUTPUT'}]);
    if (role === 'chain-consumer' && !called)
      return response([{content: 'CHAIN_CONSUMER_OUTPUT'}]);
    if (role === 'needs-source' && !called)
      return response([{content: 'NEEDS_SOURCE_OUTPUT'}]);
    if (role === 'needs-dependent' && !called)
      return response([{content: 'NEEDS_DEPENDENT_OUTPUT'}]);
    if (role === 'needs-blocked' && !called)
      return response([{content: 'UNEXPECTED_BLOCKED_OUTPUT'}]);
    if (role === 'asker') {
      if (!called)
        return response([
          tool(
            'ask_parent',
            JSON.stringify({question: 'fixture ask question'}),
            nextCallId(),
          ),
        ]);
      if (called.name === 'ask_parent') {
        answers.push(called.text);
        return response([{content: `ASK_CHILD_CONTINUED:${called.text}`}]);
      }
    }
    if (role === 'resume-completed' && !called)
      return response([
        {
          content:
            users.length > 1
              ? `RESUME_COMPLETED_CONTINUED:${latest}`
              : 'RESUME_COMPLETED_INITIAL',
        },
      ]);
    if (role === 'resume-failed' && !called)
      return response([{content: `RESUME_FAILED_CONTINUED:${latest}`}]);
    if (role === 'sibling-a') {
      if (!called)
        return response([
          tool(
            'send_agent_message',
            JSON.stringify({
              to: 'sibling-b',
              message: 'SIBLING_PAYLOAD',
            }),
            nextCallId(),
          ),
        ]);
      if (called.name === 'send_agent_message')
        return response([{content: 'SIBLING_A_SENT'}]);
    }
    if (role === 'sibling-b') {
      if (!called)
        return response([tool('poll_agent_messages', '{}', nextCallId())]);
      if (called.name === 'poll_agent_messages') {
        if (called.text.includes('SIBLING_PAYLOAD'))
          return response([{content: `SIBLING_B_RECEIVED:${called.text}`}]);
        return response([tool('poll_agent_messages', '{}', nextCallId())]);
      }
    }
    if (role === 'scoped-keep' && !called)
      return response([
        tool(
          'ask_parent',
          JSON.stringify({question: 'fixture keep task remains active'}),
          nextCallId(),
        ),
      ]);
    if (role === 'cancel-second' || role === 'cancel-third')
      return response([{content: `UNEXPECTED_${role}`}]);
    return response([{content: `MECHANISM_CHILD_${role}_DONE`}]);
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST')
        return new Response('not found', {status: 404});
      const decoded = Schema.decodeUnknownSync(Request)(await request.json());
      requests.push(decoded);
      if (!decoded.stream)
        return Response.json({
          id: 'mechanism-probe',
          object: 'chat.completion',
          model: 'mechanism-fixture',
          choices: [
            {
              index: 0,
              message: {role: 'assistant', content: 'ready'},
              finish_reason: 'stop',
            },
          ],
        });
      const first = userTexts(decoded.messages)[0] ?? '';
      const role = childRole(first);
      if (role) {
        childRequests.push({role, request: decoded, at: Date.now()});
        return childResponse(role, decoded, request.signal);
      }
      return mainResponse(decoded);
    },
  });

  await writeFile(
    join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        mechanism: {
          baseUrl: `${server.url}v1`,
          api: 'openai-completions',
          apiKey: 'offline-fixture',
          models: [{id: 'mechanism-fixture'}],
        },
      },
    }),
  );
  await writeFile(
    join(agentDir, 'settings.json'),
    JSON.stringify({quietStartup: true, retry: {enabled: false}}),
  );

  async function readSidecar(): Promise<SidecarRun[]> {
    let files: string[];
    try {
      files = await readdir(join(agentDir, 'sessions'), {recursive: true});
    } catch {
      return [];
    }
    const filename = files.find(file =>
      file.endsWith('.pi-stuff-subagents.json'),
    );
    if (!filename) return [];
    const text = await readFile(join(agentDir, 'sessions', filename), 'utf8');
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
    url: `${server.url}v1`,
    requests,
    childRequests,
    mainActions,
    awaitDurations,
    runIds,
    httpFailures,
    answers,
    readSidecar,
    waitFor,
    close,
  };
}
