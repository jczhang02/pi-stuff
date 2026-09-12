import {copyFile, mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Schema} from 'effect';

const Request = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.String,
      content: Schema.optional(
        Schema.Union([
          Schema.String,
          Schema.Null,
          Schema.Array(
            Schema.Struct({
              type: Schema.String,
              text: Schema.optional(Schema.String),
            }),
          ),
        ]),
      ),
      name: Schema.optional(Schema.String),
      tool_call_id: Schema.optional(Schema.String),
    }),
  ),
  stream: Schema.optional(Schema.Boolean),
});
export type FixtureRequest = Schema.Schema.Type<typeof Request>;

export function messageText(
  message: FixtureRequest['messages'][number] | undefined,
): string {
  const content = message?.content;
  if (Schema.is(Schema.String)(content)) return content;
  return content?.map(part => part.text ?? '').join('') ?? '';
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function workerCommand(directory: string, role: string): string {
  return [
    process.execPath,
    resolve(import.meta.dir, 'subagent-runtime-worker.ts'),
    directory,
    role,
  ]
    .map(quote)
    .join(' ');
}

type Arguments =
  | {path: string}
  | {command: string}
  | {question: string}
  | {
      tasks: {id: string; agent: string; task: string; tools: string[]}[];
      concurrency: number;
    };
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

function response(
  deltas: Delta[],
  usage = {prompt_tokens: 80, completion_tokens: 16, total_tokens: 96},
): Response {
  const id = `subagent-fixture-${Date.now()}`;
  const chunks = deltas.map(delta => ({
    id,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'subagent-fixture',
    choices: [{index: 0, delta, finish_reason: null}],
  }));
  const hasTools = deltas.some(delta => 'tool_calls' in delta);
  const finish = {
    id,
    object: 'chat.completion.chunk',
    model: 'subagent-fixture',
    choices: [
      {index: 0, delta: {}, finish_reason: hasTools ? 'tool_calls' : 'stop'},
    ],
  };
  const body =
    [...chunks, finish]
      .map(chunk => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') +
    `data: ${JSON.stringify({id, object: 'chat.completion.chunk', model: 'subagent-fixture', choices: [], usage})}\n\n` +
    'data: [DONE]\n\n';
  return new Response(body, {headers: {'content-type': 'text/event-stream'}});
}

function tool(name: string, args: Arguments, id: string): Delta {
  return {
    tool_calls: [
      {
        index: 0,
        id,
        type: 'function',
        function: {name, arguments: JSON.stringify(args)},
      },
    ],
  };
}

export async function createSubagentFixture() {
  const directory = await mkdtemp(
    join(tmpdir(), 'pi-subagent-production-e2e-'),
  );
  const agentDir = join(directory, 'agent');
  const cwd = join(directory, 'project');
  await mkdir(join(agentDir, 'sessions'), {recursive: true});
  await mkdir(cwd, {recursive: true});
  await mkdir(join(cwd, '.e2e'), {recursive: true});
  await mkdir(join(cwd, 'src'), {recursive: true});
  await copyFile(
    resolve(import.meta.dir, 'subagent-runtime-worker.ts'),
    join(cwd, '.e2e/worker.ts'),
  );
  await writeFile(
    join(cwd, 'README.md'),
    'offline subagent fixture repository\n',
  );
  await writeFile(
    join(cwd, 'src/cancel.ts'),
    'export function cancel(id: string): void { void id; }\n',
  );
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    [
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@local',
      'commit',
      '-qm',
      'fixture baseline',
    ],
  ]) {
    const result = Bun.spawnSync(['git', ...args], {cwd});
    if (result.exitCode !== 0)
      throw new Error(`fixture git command failed: git ${args.join(' ')}`);
  }
  const requests: FixtureRequest[] = [];
  const calls = new Map<string, string>();
  let sequence = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST')
        return new Response('not found', {status: 404});
      const decoded = Schema.decodeUnknownSync(Request)(await request.json());
      requests.push(decoded);
      const messages = decoded.messages;
      const last = messages.at(-1);
      const users = messages.filter(message => message.role === 'user');
      const first = messageText(users[0]);
      const latest = messageText(users.at(-1));
      if (!decoded.stream)
        return Response.json({
          id: 'probe',
          object: 'chat.completion',
          model: 'subagent-fixture',
          choices: [
            {
              index: 0,
              message: {role: 'assistant', content: 'ready'},
              finish_reason: 'stop',
            },
          ],
        });
      const role = first.includes('审查取消逻辑')
        ? 'reviewer'
        : first.includes('验证重复取消')
          ? 'tester'
          : first.includes('定位取消入口')
            ? 'explorer'
            : 'main';
      if (last?.role === 'user' && latest.includes('触发模型错误'))
        return Response.json(
          {
            error: {
              message: 'controlled provider failure',
              type: 'server_error',
            },
          },
          {status: 500},
        );
      const called = last?.tool_call_id
        ? calls.get(last.tool_call_id)
        : last?.name;
      const id = `call_${++sequence}`;
      if (last?.role === 'user' && users.length > 1)
        return response([{content: `已收到 ${role} 的补充：${latest}`}]);
      if (
        role === 'main' &&
        !messages.some(message => message.role === 'assistant')
      ) {
        const args = {
          tasks: [
            {
              id: 'reviewer',
              agent: 'reviewer',
              task: '审查取消逻辑',
              tools: ['read', 'bash'],
            },
            {
              id: 'tester',
              agent: 'tester',
              task: '验证重复取消',
              tools: ['read', 'bash'],
            },
            {
              id: 'explorer',
              agent: 'explorer',
              task: '定位取消入口',
              tools: ['read'],
            },
          ],
          concurrency: 3,
        };
        calls.set(id, 'subagent');
        return response([tool('subagent', args, id)]);
      }
      if (called === 'subagent') {
        calls.set(id, 'bash');
        return response([
          tool('bash', {command: workerCommand(directory, 'main')}, id),
        ]);
      }
      if (called === 'read' && role === 'tester') {
        calls.set(id, 'ask_parent');
        return response([
          tool('ask_parent', {question: '是否检查连续取消两次？'}, id),
        ]);
      }
      if (called === 'read' && role === 'reviewer') {
        calls.set(id, 'bash');
        return response([
          tool('bash', {command: workerCommand(directory, role)}, id),
        ]);
      }
      if (called === 'ask_parent') {
        calls.set(id, 'bash');
        return response([
          tool('bash', {command: workerCommand(directory, 'tester')}, id),
        ]);
      }
      if (called === 'bash')
        return response([
          {
            content: `${role} 检查完成。${role === 'tester' ? '连续取消测试失败，请检查工具输出。' : '已保留检查过程。'}`,
          },
        ]);
      if (
        role !== 'main' &&
        !messages.some(message => message.role === 'assistant')
      ) {
        calls.set(id, 'read');
        return response([tool('read', {path: 'src/cancel.ts'}, id)]);
      }
      return response([
        {
          content:
            role === 'explorer'
              ? '已定位取消入口。'
              : `已收到 ${role} 的补充：${latest}`,
        },
      ]);
    },
  });
  await writeFile(
    join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        local: {
          baseUrl: `${server.url}v1`,
          api: 'openai-completions',
          apiKey: 'offline-fixture',
          models: [{id: 'subagent-fixture'}],
        },
      },
    }),
  );
  await writeFile(
    join(agentDir, 'settings.json'),
    JSON.stringify({quietStartup: true, retry: {enabled: false}}),
  );
  async function release(role: string) {
    await writeFile(join(directory, `${role}.release`), 'release\n');
  }
  async function close() {
    await server.stop(true);
    await rm(directory, {recursive: true, force: true});
  }
  return {
    directory,
    agentDir,
    cwd,
    url: `${server.url}v1`,
    requests,
    release,
    close,
  };
}
