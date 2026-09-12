import {copyFile, mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Effect, Schema} from 'effect';

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
  return Schema.is(Schema.String)(content)
    ? content
    : (content?.map(part => part.text ?? '').join('') ?? '');
}
function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function command(role: string) {
  return [process.execPath, '.e2e/worker.ts', '..', role].map(quote).join(' ');
}
type Delta =
  | {content: string}
  | {
      tool_calls: {
        index: number;
        id: string;
        type: string;
        function: {name: string; arguments: string};
      }[];
    };
function response(
  deltas: Delta[],
  usage = {prompt_tokens: 120, completion_tokens: 24, total_tokens: 144},
) {
  const id = `fixture-${Date.now()}`;
  const chunks = deltas.map(delta => ({
    id,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'development',
    choices: [{index: 0, delta, finish_reason: null}],
  }));
  const hasTools = deltas.some(delta => 'tool_calls' in delta);
  const finish = {
    id,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'development',
    choices: [
      {index: 0, delta: {}, finish_reason: hasTools ? 'tool_calls' : 'stop'},
    ],
  };
  const body =
    [...chunks, finish]
      .map(chunk => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') +
    `data: ${JSON.stringify({id, object: 'chat.completion.chunk', model: 'development', choices: [], usage})}\n\n` +
    'data: [DONE]\n\n';
  return new Response(body, {headers: {'content-type': 'text/event-stream'}});
}
type CallArguments =
  | {path: string}
  | {command: string}
  | {question: string}
  | {
      tasks: {id: string; agent: string; task: string; tools: string[]}[];
      concurrency: number;
    };
function tool(name: string, args: CallArguments, id: string): Delta {
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

export async function createFixture() {
  const directory = await Effect.runPromise(
    Effect.promise(() => mkdtemp(join(tmpdir(), 'pi-subagent-runtime-e2e-'))),
  );
  const agentDir = join(directory, 'agent');
  const cwd = join(directory, 'project');
  await mkdir(join(agentDir, 'sessions'), {recursive: true});
  await mkdir(join(cwd, 'src'), {recursive: true});
  await mkdir(join(cwd, '.e2e'), {recursive: true});
  await copyFile(
    resolve(import.meta.dir, 'fixture-worker.ts'),
    join(cwd, '.e2e/worker.ts'),
  );
  await writeFile(
    join(cwd, 'src/cancel.ts'),
    'export function cancel(id: string): void { void id; }\n',
  );
  const requests: FixtureRequest[] = [];
  const calls = new Map<string, string>();
  let sequence = 0;
  function call(name: string, args: CallArguments) {
    const id = `call_${++sequence}`;
    calls.set(id, name);
    return response([tool(name, args, id)]);
  }
  function final(text: string) {
    const middle = Math.ceil(text.length / 2);
    return response([
      {content: text.slice(0, middle)},
      {content: text.slice(middle)},
    ]);
  }
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
      const first = users[0];
      const firstText = messageText(first);
      const latest = messageText(users.at(-1));
      if (!decoded.stream)
        return Response.json({
          id: 'completion',
          object: 'chat.completion',
          model: 'development',
          choices: [
            {
              index: 0,
              message: {role: 'assistant', content: 'ready'},
              finish_reason: 'stop',
            },
          ],
          usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
        });
      const name = last?.tool_call_id
        ? calls.get(last.tool_call_id)
        : last?.name;
      const role = firstText.includes('审查取消逻辑')
        ? 'reviewer'
        : firstText.includes('验证重复取消')
          ? 'tester'
          : firstText.includes('定位取消入口')
            ? 'explorer'
            : 'main';
      if (last?.role === 'user' && latest === '触发模型错误')
        return Response.json(
          {
            error: {
              message: 'controlled provider failure',
              type: 'server_error',
            },
          },
          {status: 500},
        );
      if (users.length > 1 && last?.role === 'user')
        return final(`已收到 ${role} 的补充：${latest}`);
      if (
        role === 'main' &&
        !messages.some(message => message.role === 'assistant')
      )
        return call('subagent', {
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
        });
      if (name === 'subagent') return call('bash', {command: command('main')});
      if (name === 'read' && role === 'tester')
        return call('ask_parent', {question: '是否检查连续取消两次？'});
      if (name === 'read' && role === 'reviewer')
        return call('bash', {command: command(role)});
      if (name === 'ask_parent')
        return call('bash', {command: command('tester')});
      if (name === 'bash')
        return final(
          `${role} 检查完成。${role === 'tester' ? '连续取消测试失败，请检查工具输出。' : '已保留检查过程。'}`,
        );
      if (
        role !== 'main' &&
        !messages.some(message => message.role === 'assistant')
      )
        return call('read', {path: 'src/cancel.ts'});
      return final(
        role === 'explorer'
          ? '已定位 src/cancel.ts 的取消入口。'
          : `已收到 ${role} 的补充：${latest}`,
      );
    },
  });
  await writeFile(
    join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        local: {
          baseUrl: `${server.url}v1`,
          api: 'openai-completions',
          apiKey: 'offline-only',
          models: [{id: 'development'}],
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
    await Effect.runPromise(
      Effect.promise(() => rm(directory, {recursive: true, force: true})),
    );
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
