// Throwaway, in-memory UI fixtures. No agent execution or model requests.
export type Status = '运行中' | '等待输入' | '已完成' | '已停止';
export type Message =
  | {kind: 'user' | 'assistant'; text: string}
  | {kind: 'tool'; name: string; summary: string; detail: string};

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
  remaining: number;
}

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
      activity: '整合审查结果，修改取消逻辑',
      answer:
        '我已分派审查、测试和代码定位。你可以进入任一代理的对话；我会继续处理实现。',
    },
    {
      id: 'reviewer',
      name: 'reviewer',
      role: '代码审查',
      task: '检查取消操作、重复取消与资源释放',
      status: '运行中',
      activity: 'Read src/subagent/manager.ts',
      answer:
        '我正在检查取消后的资源释放。重点是：等待中的任务能否退出，以及重复取消是否安全。',
    },
    {
      id: 'tester',
      name: 'tester',
      role: '测试验证',
      task: '验证取消操作的边界情况',
      status: '等待输入',
      activity: '需要确认：是否包含连续取消两次？',
      answer:
        '已经准备好测试场景。是否也检查连续取消两次？直接在这里回复我即可。',
    },
    {
      id: 'explorer',
      name: 'explorer',
      role: '代码定位',
      task: '定位取消入口及调用关系',
      status: '已完成',
      activity: '已找到 3 处相关入口，可继续追问',
      answer:
        '定位完成：`cancelTask` 发出取消请求，`runChild` 释放会话，`awaitRun` 等待结果。你可以继续让我检查其中一条路径。',
    },
  ];
  return specs.map(spec => ({
    ...spec,
    messages: [
      {kind: 'user', text: spec.task},
      {kind: 'assistant', text: spec.answer},
      {
        kind: 'tool',
        name: 'read',
        summary: 'src/subagent/manager.ts · 取消处理',
        detail:
          '```ts\nfunction cancelTask(taskId: string) {\n  const task = tasks.get(taskId);\n  task?.controller.abort();\n  releaseSession(taskId);\n}\n```\n模拟工具结果，用于检查代码、换行与展开效果；不是当前仓库实现。',
      },
      {
        kind: 'assistant',
        text:
          spec.status === '等待输入'
            ? '等待你的范围确认。其他代理会继续运行。'
            : '已读完相关代码。你可以展开工具结果，或直接输入要补充检查的内容。',
      },
    ],
    draft: '',
    scroll: 0,
    expanded: false,
    unread: spec.status === '等待输入' ? 1 : 0,
    elapsed: spec.id === 'explorer' ? 28 : 12,
    tools: spec.id === 'main' ? 4 : 6,
    remaining: spec.id === 'reviewer' ? 45 : 0,
  }));
}

export function advance(
  agents: DemoAgent[],
  viewing: string | undefined,
): void {
  for (const agent of agents) {
    if (agent.status !== '运行中') continue;
    agent.elapsed += 1;
    if (agent.elapsed % 5 === 0) {
      agent.tools += 1;
      agent.activity =
        agent.tools % 2 === 0
          ? 'Read src/subagent/manager.ts'
          : 'Grep cancelTask · 检查调用关系';
    }
    if (agent.remaining <= 0) continue;
    agent.remaining -= 1;
    if (agent.remaining > 0) continue;
    agent.status = '已完成';
    agent.activity = '本轮已完成，可以在原对话中继续';
    agent.messages.push({
      kind: 'assistant',
      text: '这一轮检查完成（模拟回复）。取消入口和重复取消的路径都已检查；你可以继续追问，之前的对话仍会保留。',
    });
    if (viewing !== agent.id) agent.unread += 1;
  }
}

export function send(agent: DemoAgent, value: string): void {
  const text = value.trim();
  if (!text) return;
  const continuing = agent.status === '已完成' || agent.status === '已停止';
  agent.messages.push({kind: 'user', text});
  agent.messages.push({
    kind: 'assistant',
    text: continuing
      ? '我会沿用这段对话继续检查你的新要求。（模拟回复）'
      : '已收到你的补充要求，我会把它纳入当前检查。（模拟回复）',
  });
  agent.status = '运行中';
  agent.activity = '正在处理你的消息（模拟）';
  agent.remaining = 4;
  agent.draft = '';
  agent.scroll = 0;
}
