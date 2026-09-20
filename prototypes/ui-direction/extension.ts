// Throwaway Pi-hosted UI exploration. Sample execution is deliberately offline.
import {
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
  getMarkdownTheme,
  getSettingsListTheme,
  DynamicBorder,
} from '@earendil-works/pi-coding-agent';
import {
  type Component,
  Markdown,
  Box,
  visibleWidth,
  SettingsList,
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import {getScene, type ToolSample} from './scenes';
import {welcomeLines} from './welcome';

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
  const title = `${theme.fg(color, '•')} ${theme.bold(theme.fg('toolTitle', tool.name))}(${theme.fg('text', tool.target)})`;
  const output = expanded
    ? tool.output
    : tool.name === 'Edit' || tool.state === 'failed'
      ? tool.output
      : tool.output.slice(0, 2);
  const lines = [
    ...wrapTextWithAnsi(title, width - 2),
    theme.fg('muted', ' ⎿  ') + theme.fg(color, tool.result),
    ...output.flatMap(line => {
      const token = line.startsWith('+')
        ? 'toolDiffAdded'
        : line.startsWith('−')
          ? 'toolDiffRemoved'
          : 'toolOutput';
      return wrapTextWithAnsi(theme.fg(token, `    ${line}`), width - 2);
    }),
  ];
  if (!expanded && output.length < tool.output.length)
    lines.push(
      theme.fg(
        'dim',
        `    … ${tool.output.length - output.length} more lines · Ctrl+O expand`,
      ),
    );
  return lines.map(line => ` ${line}`);
}

export default function uiDirection(pi: ExtensionAPI) {
  const scene = process.env.PI_UI_SCENE ?? 'work';
  const messages = getScene(scene);

  for (const [index, message] of messages.entries()) {
    pi.registerMessageRenderer(
      `ui-direction-${index}`,
      (_message, options, theme) => {
        if (message.kind === 'tool')
          return linesComponent(width =>
            toolLines(message.tool, theme, options.expanded, width),
          );
        const markdown = new Markdown(message.text, 0, 0, getMarkdownTheme());
        const content = linesComponent(width =>
          markdown
            .render(Math.max(1, width - 2))
            .map(
              (line, index) =>
                `${index === 0 ? theme.fg(message.kind === 'user' ? 'mdQuote' : 'accent', message.kind === 'user' ? ' ' : '• ') : '  '}${line}`,
            ),
        );
        const box = new Box(
          1,
          message.kind === 'user' ? 1 : 0,
          message.kind === 'user'
            ? text => theme.bg('userMessageBg', text)
            : undefined,
        );
        box.addChild(content);
        return box;
      },
    );
  }

  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.setHeader((tui, theme) =>
      linesComponent(width =>
        scene === 'welcome'
          ? welcomeLines(theme, width, tui.terminal.rows)
          : [],
      ),
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
      await commandCtx.ui.custom<void>((tui, theme, keys, done) => {
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
          ],
          5,
          {
            ...getSettingsListTheme(),
            hint: () =>
              theme.fg(
                'dim',
                ` ${keys.getKeys('tui.select.up').join('/')} / ${keys.getKeys('tui.select.down').join('/')} Navigate · ${keys.getKeys('tui.select.confirm').join('/')} Change · Esc Close`,
              ),
          },
          (id, value) => {
            if (id === 'tools') {
              commandCtx.ui.setToolsExpanded(value === 'full');
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
        await commandCtx.ui.custom<void>((tui, theme, keys, done) => {
          let index = 0;
          let offset = 0;
          let maximumOffset = 0;
          let detailFocus = false;
          const navigation = `${keys.getKeys('tui.select.up').join('/')} / ${keys.getKeys('tui.select.down').join('/')}`;
          const confirm = keys.getKeys('tui.select.confirm').join('/');
          return {
            render(width) {
              const split = width >= 96;
              const leftWidth = split ? Math.floor(width * 0.32) : width;
              const rightWidth = split ? width - leftWidth - 1 : width;
              const height = Math.max(3, Math.min(16, tui.terminal.rows - 12));
              const tool = tools[index];
              const rows = tool
                ? toolLines(tool, theme, true, rightWidth)
                : [' No tools in this session.'];
              maximumOffset = Math.max(0, rows.length - height + 4);
              offset = Math.min(offset, maximumOffset);
              const list = [
                ` ${theme.bold('Tools')} · ${tools.length} activities`,
                '',
                ...tools.map((item, position) =>
                  theme.fg(
                    position === index ? 'accent' : 'muted',
                    ` ${position === index ? '›' : ' '} ${item.name}(${item.target})`,
                  ),
                ),
              ];
              const detail = [
                ` ${theme.bold(`Tools / ${tool?.name ?? 'Empty'}`)} · ${tools.length ? index + 1 : 0}/${tools.length}`,
                '',
                ...rows.slice(offset, offset + height - 4),
              ];
              const fit = (line: string, columns: number) => {
                const clipped = truncateToWidth(line, columns);
                return (
                  clipped +
                  ' '.repeat(Math.max(0, columns - visibleWidth(clipped)))
                );
              };
              const body = Array.from({length: height}, (_, row) =>
                split
                  ? `${fit(list[row] ?? '', leftWidth)}${theme.fg('borderMuted', '│')}${fit(detail[row] ?? '', rightWidth)}`
                  : fit((detailFocus ? detail : list)[row] ?? '', width),
              );
              return [
                theme.fg('borderAccent', '─'.repeat(width)),
                ...body,
                truncateToWidth(
                  theme.fg(
                    'dim',
                    detailFocus
                      ? ` ${navigation} Scroll · Tab List · Esc Back`
                      : ` ${navigation} Select · ${confirm} Details · Tab Pane · [ ] Select · Esc Close`,
                  ),
                  width,
                ),
                theme.fg('borderAccent', '─'.repeat(width)),
              ];
            },
            handleInput(data) {
              if (matchesKey(data, Key.escape)) {
                if (detailFocus) detailFocus = false;
                else done();
              } else if (
                matchesKey(data, Key.tab) ||
                keys.matches(data, 'tui.select.confirm')
              ) {
                detailFocus = !detailFocus;
              } else if (
                data === ']' ||
                data === '[' ||
                (!detailFocus &&
                  (keys.matches(data, 'tui.select.down') ||
                    keys.matches(data, 'tui.select.up')))
              ) {
                const next =
                  data === ']' || keys.matches(data, 'tui.select.down');
                index = Math.max(
                  0,
                  Math.min(tools.length - 1, index + (next ? 1 : -1)),
                );
                offset = 0;
              } else if (keys.matches(data, 'tui.select.down'))
                offset = Math.min(maximumOffset, offset + 1);
              else if (keys.matches(data, 'tui.select.up'))
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
