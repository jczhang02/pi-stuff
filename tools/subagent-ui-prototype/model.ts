// In-memory fixture playback. No model requests, shell commands or repository reads.
import type {
  BashToolInput,
  ReadToolInput,
} from '@earendil-works/pi-coding-agent';

export type Status = '运行中' | '等待输入' | '已完成' | '已停止';
export type ToolMessage = {
  kind: 'tool';
  detail: string;
  state: 'running' | 'success' | 'error';
} & ({name: 'read'; args: ReadToolInput} | {name: 'bash'; args: BashToolInput});
export type Message =
  | {kind: 'user'; text: string}
  | {kind: 'assistant'; text: string; streaming: boolean}
  | ToolMessage;

export interface DemoAgent {
  id: string;
  name: string;
  role: string;
  task: string;
  status: Status;
  activity: string;
  messages: Message[];
  draft: string;
  scroll: number;
  expanded: boolean;
  unread: number;
  elapsed: number;
  tools: number;
  step: number;
  pending: number;
}

const sampleCode = `export async function cancelTask(taskId: string) {
  const task = tasks.get(taskId);
  if (!task) return;

  task.controller.abort();
  await task.finished;
  tasks.delete(taskId);
}

export async function runChild(task: Task) {
  try {
    await task.session.prompt(task.prompt);
  } finally {
    await task.session.dispose();
    task.resolveFinished();
  }
}`;

export function createAgents(): DemoAgent[] {
  const specs: {
    id: string;
    name: string;
    role: string;
    task: string;
    status: Status;
    activity: string;
    answer: string;
  }[] = [
    {
      id: 'main',
      name: '主代理',
      role: '协调与实现',
      task: '完善任务取消与资源释放',
      status: '运行中',
      activity: '等待审查结果，整理修改范围',
      answer:
        '我已分派审查、测试和代码定位。目前需要确认：取消请求发出后，子会话是否总能释放。',
    },
    {
      id: 'reviewer',
      name: 'reviewer',
      role: '代码审查',
      task: '检查取消操作、重复取消与资源释放',
      status: '运行中',
      activity: '检查取消后的资源释放',
      answer:
        '我正在检查取消后的资源释放。`abort()` 只发出信号；还需要确认等待者能结束、会话能释放。下面是待审查的代码。',
    },
    {
      id: 'tester',
      name: 'tester',
      role: '测试验证',
      task: '验证取消操作的边界情况',
      status: '等待输入',
      activity: '需要确认：是否包含连续取消两次？',
      answer:
        '已准备单次取消的测试。是否也检查连续取消两次？直接在这里回复即可。其他代理继续运行。',
    },
    {
      id: 'explorer',
      name: 'explorer',
      role: '代码定位',
      task: '定位取消入口及调用关系',
      status: '已完成',
      activity: '已找到 3 处相关入口，可继续追问',
      answer:
        '定位完成：`cancelTask` 发出取消请求，`runChild` 释放会话，`awaitRun` 等待结果。\n\n建议优先检查 `finally` 中的释放路径。你可以继续让我追踪其中一条调用。',
    },
  ];
  return specs.map(spec => ({
    ...spec,
    messages: [
      {kind: 'user', text: spec.task},
      {kind: 'assistant', text: spec.answer, streaming: false},
      ...(spec.id === 'tester' ? [] : [readResult()]),
    ],
    draft: '',
    scroll: 0,
    expanded: false,
    unread: spec.status === '等待输入' ? 1 : 0,
    elapsed: spec.id === 'explorer' ? 28 : 12,
    tools: spec.id === 'tester' ? 0 : 1,
    step: spec.id === 'main' ? -60 : 0,
    pending: 0,
  }));
}

function readResult(): ToolMessage {
  return {
    kind: 'tool',
    name: 'read',
    args: {path: 'src/subagent/manager.ts', offset: 40, limit: 18},
    detail: sampleCode,
    state: 'success',
  };
}

const intro =
  '我会先验证等待者是否收到结束信号，再检查重复取消。现在运行这组取消场景，结果会逐条显示在下面。';
const passOutput =
  'bun test v1.4.0\n\n(pass) cancel running task\n(pass) cancel queued task\n(pass) cancel twice\n\n3 pass\n0 fail';
const failOutput =
  'bun test v1.4.0\n\n(pass) cancel running task\n(pass) cancel queued task\n(fail) cancel twice\n\nerror: Test timed out after 5000ms\n  at tests/subagent/cancel.test.ts:42\n\n2 pass\n1 fail\nProcess exited with code 1';

export function advance(
  agents: DemoAgent[],
  viewing: string | undefined,
): void {
  for (const agent of agents) {
    if (agent.status !== '运行中') continue;
    agent.step += 1;
    if (agent.step % 5 === 0) agent.elapsed += 1;
    if (agent.step < 1) continue;
    if (agent.step === 1) {
      agent.activity = '分析取消边界';
      agent.messages.push({kind: 'assistant', text: '', streaming: true});
    }
    if (agent.step <= 20) {
      const current = agent.messages.findLast(
        entry => entry.kind === 'assistant',
      );
      if (current?.kind === 'assistant') {
        current.text = intro.slice(
          0,
          Math.ceil((intro.length * agent.step) / 20),
        );
        current.streaming = agent.step < 20;
      }
    }
    if (agent.step === 24) {
      agent.tools += 1;
      agent.activity = 'Bash · bun test tests/subagent/cancel.test.ts';
      agent.messages.push({
        kind: 'tool',
        name: 'bash',
        args: {command: 'bun test tests/subagent/cancel.test.ts', timeout: 30},
        detail: '',
        state: 'running',
      });
    }
    const fails = agent.id === 'reviewer';
    if (agent.step >= 30 && agent.step <= 60) {
      const tool = agent.messages.findLast(entry => entry.kind === 'tool');
      if (tool?.kind === 'tool' && tool.name === 'bash') {
        const output = fails ? failOutput : passOutput;
        tool.detail = output
          .split('\n')
          .slice(0, Math.floor((agent.step - 25) / 3))
          .join('\n');
        if (agent.step === 60) {
          tool.detail = output;
          tool.state = fails ? 'error' : 'success';
        }
      }
    }
    if (agent.step === 64) {
      agent.activity = '整理检查结果';
      agent.messages.push({kind: 'assistant', text: '', streaming: true});
    }
    if (agent.step >= 64 && agent.step <= 90) {
      const final = fails
        ? '**发现一处问题：连续取消会让第二个等待者超时。**\n\n单次取消与排队任务取消通过。重复取消失败，位置在 `tests/subagent/cancel.test.ts:42`。建议让同一任务的取消请求复用同一个完成信号。\n\n这轮审查完成。你可以继续让我检查修复后的路径。'
        : '**本轮检查完成。**\n\n单次取消、排队任务取消与重复取消均通过。会话在 `finally` 中释放，等待者能收到完成信号。\n\n你可以继续追问；之前的对话和工具结果仍在。';
      const current = agent.messages.findLast(
        entry => entry.kind === 'assistant',
      );
      if (current?.kind === 'assistant') {
        current.text = final.slice(
          0,
          Math.ceil((final.length * (agent.step - 63)) / 27),
        );
        current.streaming = agent.step < 90;
      }
    }
    if (agent.step === 90) {
      agent.status = agent.pending ? '运行中' : '已完成';
      agent.activity = agent.pending
        ? '继续处理你的补充消息'
        : fails
          ? '审查完成 · 发现 1 项问题'
          : '本轮已完成，可以在原对话中继续';
      agent.step = 0;
      agent.pending = 0;
      if (viewing !== agent.id) agent.unread += 1;
    }
  }
}

export function send(agent: DemoAgent, value: string): void {
  const text = value.trim();
  if (!text) return;
  agent.messages.push({kind: 'user', text});
  if (agent.status === '运行中') agent.pending += 1;
  else {
    agent.status = '运行中';
    agent.activity = '正在处理你的消息';
    agent.step = 0;
  }
  agent.draft = '';
  agent.scroll = 0;
}

export function stop(agent: DemoAgent): void {
  agent.status = '已停止';
  agent.activity = '已停止，历史消息保留';
  agent.pending = 0;
  for (const entry of agent.messages) {
    if (entry.kind === 'assistant') entry.streaming = false;
    if (entry.kind === 'tool' && entry.state === 'running') {
      entry.state = 'error';
      entry.detail += '\n执行已停止。';
    }
  }
  agent.messages.push({
    kind: 'assistant',
    text: '已停止当前工作。已有消息和结果保留；发送新要求可以继续。',
    streaming: false,
  });
}
