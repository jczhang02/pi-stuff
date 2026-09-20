// Throwaway Pi-hosted UI exploration. Sample execution is deliberately offline.
import {
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
  UserMessageComponent,
  getMarkdownTheme,
  getSettingsListTheme,
  DynamicBorder,
} from '@earendil-works/pi-coding-agent';
import {
  type Component,
  Markdown,
  Text,
  SettingsList,
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import {getScene, taskRows, agentRows, type ToolSample} from './scenes';

function linesComponent(render: (width: number) => string[]): Component {
  return {
    render,
    invalidate() {
      /* Fixture data has no cached layout. */
    },
  };
}

function toolLines(
  tool: ToolSample,
  theme: Theme,
  expanded: boolean,
  width: number,
) {
  const color =
    tool.state === 'failed'
      ? 'error'
      : tool.state === 'running'
        ? 'accent'
        : 'success';
  const mark =
    tool.state === 'failed' ? '✗' : tool.state === 'running' ? '●' : '✓';
  const title = `${theme.fg(color, mark)} ${theme.bold(theme.fg('toolTitle', tool.name))}  ${theme.fg('text', tool.target)}`;
  const output = expanded
    ? tool.output
    : tool.name === 'Edit' || tool.state === 'failed'
      ? tool.output
      : tool.output.slice(0, 2);
  const lines = [
    ...wrapTextWithAnsi(title, width - 2),
    theme.fg(color, `  ${tool.result}`),
    ...output.flatMap(line => {
      const token = line.startsWith('+')
        ? 'toolDiffAdded'
        : line.startsWith('−')
          ? 'toolDiffRemoved'
          : 'toolOutput';
      return wrapTextWithAnsi(theme.fg(token, `  ${line}`), width - 2);
    }),
  ];
  if (!expanded && output.length < tool.output.length)
    lines.push(
      theme.fg(
        'dim',
        `  … ${tool.output.length - output.length} more lines · Ctrl+O expand`,
      ),
    );
  return lines.map(line => ` ${line}`);
}

export default function uiDirection(pi: ExtensionAPI) {
  const scene = process.env.PI_UI_SCENE ?? 'work';
  const messages = getScene(scene);
  let taskDisplay = 'expanded';

  for (const [index, message] of messages.entries()) {
    pi.registerMessageRenderer(
      `ui-direction-${index}`,
      (_message, options, theme) => {
        if (message.kind === 'user')
          return new UserMessageComponent(message.text, getMarkdownTheme(), 1);
        if (message.kind === 'assistant')
          return new Markdown(message.text, 1, 0, getMarkdownTheme());
        if (message.kind === 'tool')
          return linesComponent(width =>
            toolLines(message.tool, theme, options.expanded, width),
          );
        return new Text('');
      },
    );
  }

  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.setHeader((_tui, theme) =>
      linesComponent(width => [
        ` ${theme.bold(theme.fg('accent', 'PI STUFF'))}${theme.fg('muted', '  /  pi-stuff')}`,
        ...(scene === 'welcome'
          ? [
              '',
              ` ${theme.fg('accent', '██████  ')}  ${theme.bold(theme.fg('text', 'Welcome back!'))}`,
              ` ${theme.fg('accent', '██  ██  ')}  ${theme.fg('text', 'What would you like to work on?')}`,
              ` ${theme.fg('accent', '████  ██')}  ${theme.fg('muted', '4 extensions · 18 tools · 6 skills')}`,
              ` ${theme.fg('accent', '██    ██')}  ${theme.fg('muted', 'Type a request, @ for files, / for commands.')}`,
              '',
              ...wrapTextWithAnsi(
                theme.fg(
                  'dim',
                  ' /model Choose model   /resume Continue session   /ui Display settings',
                ),
                width,
              ),
            ]
          : []),
      ]),
    );
    ctx.ui.setFooter((_tui, theme) =>
      linesComponent(width => {
        const project = theme.fg(
          'muted',
          ' pi-stuff  ·  fix/search-pagination',
        );
        const stats =
          scene === 'welcome'
            ? '0% context'
            : scene === 'complete'
              ? '18% context · $0.24'
              : '12% context · $0.16';
        return [
          truncateToWidth(project, width),
          truncateToWidth(
            ` ${theme.fg('text', 'gpt-5.4')} ${theme.fg('dim', `· high  ·  ${stats}`)}`,
            width,
          ),
        ];
      }),
    );
    const updateTasks = () => {
      if (scene !== 'tasks') return;
      ctx.ui.setWidget('tasks', (_tui, theme) =>
        linesComponent(width => [
          theme.fg('borderMuted', '─'.repeat(Math.max(1, width))),
          ` ${theme.bold(theme.fg('accent', 'Todo'))} ${theme.fg('muted', '2/4 complete')}`,
          ...(taskDisplay === 'expanded'
            ? taskRows.map(
                row =>
                  ` ${theme.fg(row.startsWith('✓') ? 'muted' : 'text', row)}`,
              )
            : [` ${theme.fg('text', taskRows[2] ?? '')}`]),
          ` ${theme.bold(theme.fg('accent', 'Agents'))} ${theme.fg('muted', '1 running · 1 done')}`,
          ...agentRows.flatMap(row =>
            wrapTextWithAnsi(` ${theme.fg('text', row)}`, width),
          ),
        ]),
      );
    };
    updateTasks();
    for (const [index, message] of messages.entries()) {
      pi.sendMessage({
        customType: `ui-direction-${index}`,
        content: message.kind === 'tool' ? message.tool.target : message.text,
        display: true,
      });
    }
    ctx.ui.setEditorText(scene === 'complete' ? '检查一下完整 diff' : '');
    const openSettings = async (commandCtx: ExtensionContext) => {
      const draft = commandCtx.ui.getEditorText();
      await commandCtx.ui.custom<void>((tui, theme, _keys, done) => {
        const border = new DynamicBorder(text =>
          theme.fg('borderAccent', text),
        );
        const settings = new SettingsList(
          [
            {
              id: 'tools',
              label: 'Tool output',
              currentValue: commandCtx.ui.getToolsExpanded()
                ? 'full'
                : 'preview',
              values: ['preview', 'full'],
              description:
                'Show a short result with key output, or keep all output expanded.',
            },
            {
              id: 'tasks',
              label: 'Task list',
              currentValue: taskDisplay,
              values: ['expanded', 'compact'],
              description:
                'Keep the full task list visible, or show the current step.',
            },
          ],
          5,
          {
            ...getSettingsListTheme(),
            hint: () =>
              theme.fg('dim', ' ↑↓ Navigate · Enter Change · Esc Close'),
          },
          (id, value) => {
            if (id === 'tools') {
              commandCtx.ui.setToolsExpanded(value === 'full');
            } else {
              taskDisplay = value;
              updateTasks();
            }
          },
          done,
        );
        return {
          render: width => [
            ...border.render(width),
            ` ${theme.bold(theme.fg('accent', 'Display settings'))}`,
            '',
            ...settings.render(width),
            '',
            ...border.render(width),
          ],
          handleInput(data) {
            if (matchesKey(data, Key.escape)) done();
            else settings.handleInput(data);
            tui.requestRender();
          },
          invalidate() {
            settings.invalidate();
          },
        };
      });
      commandCtx.ui.setEditorText(draft);
    };
    pi.registerCommand('ui', {
      description: 'Adjust display settings',
      handler: async (_args, commandCtx) => openSettings(commandCtx),
    });
    pi.registerShortcut('ctrl+alt+u', {
      description: 'Open display settings',
      handler: openSettings,
    });
    pi.registerCommand('tools', {
      description: 'Inspect the complete tool output',
      handler: async (_args, commandCtx) => {
        const tools = messages.flatMap(message =>
          message.kind === 'tool' ? [message.tool] : [],
        );
        await commandCtx.ui.custom<void>((tui, theme, _keys, done) => {
          let index = 0;
          let offset = 0;
          let maximumOffset = 0;
          return {
            render(width) {
              const tool = tools[index];
              const rows = tool
                ? toolLines(tool, theme, true, width)
                : [' No tools in this session.'];
              const height = Math.max(3, tui.terminal.rows - 12);
              maximumOffset = Math.max(0, rows.length - height);
              offset = Math.min(offset, maximumOffset);
              const body = rows.slice(offset, offset + height);
              return [
                theme.fg('borderAccent', '─'.repeat(width)),
                ` ${theme.bold('Tool output')}  ${tools.length ? `${index + 1}/${tools.length}` : '0 tools'}`,
                '',
                ...body,
                '',
                theme.fg('dim', ' [ Previous · ] Next · ↑↓ Scroll · Esc Close'),
                theme.fg('borderAccent', '─'.repeat(width)),
              ];
            },
            handleInput(data) {
              if (matchesKey(data, Key.escape)) done();
              else if (data === ']' && tools.length > 0) {
                index = Math.min(tools.length - 1, index + 1);
                offset = 0;
              } else if (data === '[' && tools.length > 0) {
                index = Math.max(0, index - 1);
                offset = 0;
              } else if (matchesKey(data, Key.down))
                offset = Math.min(maximumOffset, offset + 1);
              else if (matchesKey(data, Key.up))
                offset = Math.max(0, offset - 1);
              tui.requestRender();
            },
            invalidate() {
              /* Render reads the selected fixture directly. */
            },
          };
        });
      },
    });
  });
}
