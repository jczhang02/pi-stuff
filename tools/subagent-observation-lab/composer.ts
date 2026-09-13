// Native editor/footer assembly shared only by these throwaway candidates.
import {
  CustomEditor,
  FooterComponent,
  type AgentSession,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {CombinedAutocompleteProvider, type TUI} from '@earendil-works/pi-tui';
import type {KeybindingsManager} from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js';
import {getEditorTheme} from '../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import {decorateEditor} from '../subagent-observation-prototype/chrome';
import {
  send,
  stop,
  type ObservationAgent,
} from '../subagent-observation-prototype/scenario';

export function createComposer(
  agent: ObservationAgent,
  session: AgentSession,
  tui: TUI,
  keys: KeybindingsManager,
  theme: Theme,
  callbacks: {
    focus(): void;
    refresh(): void;
    sent(): void;
    exit(): void;
    back(): void;
  },
) {
  const notices: string[] = [];
  const editor = new CustomEditor(tui, getEditorTheme(), keys, {paddingX: 0});
  editor.borderColor = theme.getThinkingBorderColor('medium');
  decorateEditor(editor, agent, theme);
  const mouse = editor.handleMouse.bind(editor);
  editor.handleMouse = event => {
    if (event.type === 'press') callbacks.focus();
    return mouse(event);
  };
  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
      [
        {name: 'help', description: '查看快捷键'},
        {name: 'stats', description: '查看当前任务与用量'},
        {name: 'stop', description: '停止当前代理'},
      ],
      process.cwd(),
    ),
  );
  editor.onSubmit = text => {
    if (!text.trim()) return;
    if (text.startsWith('/')) {
      if (text.trim() === '/stop') stop(agent);
      else if (text.trim() === '/help')
        notices.push(
          'Alt+Left 返回观察；Ctrl+Shift+F 搜索完整对话；Ctrl+O 展开工具；Esc 停止；Ctrl+D 退出。',
        );
      else if (text.trim() === '/stats')
        notices.push(
          `${agent.name} · ${agent.task}\n${agent.inputTokens} input · ${agent.outputTokens} output · ${agent.elapsed}s`,
        );
      else {
        notices.push(`无法执行 ${text.trim()}。使用 /help 查看当前会话命令。`);
        editor.setText(text);
        callbacks.sent();
        return;
      }
    } else send(agent, text);
    editor.addToHistory(text);
    editor.setText('');
    callbacks.sent();
  };
  editor.onAction('app.tools.expand', () => {
    agent.expanded = !agent.expanded;
    callbacks.refresh();
  });
  editor.onAction('app.clear', () => {
    editor.setText('');
    callbacks.refresh();
  });
  editor.onCtrlD = callbacks.exit;
  editor.onEscape = () => {
    if (agent.status === 'running') stop(agent);
    else callbacks.back();
    callbacks.refresh();
  };
  const footer = new FooterComponent(session, {
    getGitBranch: () => null,
    getExtensionStatuses: () => new Map<string, string>(),
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  });
  footer.setAutoCompactEnabled(false);
  return {editor, footer, notices};
}
