// Throwaway Pi-hosted UI exploration. Sample execution is deliberately offline.
import {
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
  getMarkdownTheme,
  getSettingsListTheme,
  DynamicBorder,
  highlightCode,
} from '@earendil-works/pi-coding-agent';
import {
  type Component,
  Markdown,
  Box,
  SettingsList,
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';
import {getScene, type ToolSample} from './scenes';
import {welcomeLines} from './welcome';
import {diffVariantLines, type DiffVariant} from './diff-variants';

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
  variant: DiffVariant,
) {
  const color =
    tool.state === 'failed'
      ? 'error'
      : tool.state === 'running'
        ? 'accent'
        : 'success';
  const title = `${theme.fg(color, '•')} ${theme.bold(theme.fg('toolTitle', tool.name))}(${theme.fg('text', tool.target)})`;
  if (tool.name === 'Edit')
    return [
      ` ${title}`,
      theme.fg('muted', '  ⎿  ') +
        theme.fg(color, '+3 −1 · preserve order and skip previous IDs'),
      ...diffVariantLines(theme, width, variant),
    ];
  const output =
    expanded || tool.state === 'failed' ? tool.output : tool.output.slice(0, 2);
  const lines = [
    ...wrapTextWithAnsi(title, width - 2),
    theme.fg('muted', ' ⎿  ') + theme.fg(color, tool.result),
    ...output.flatMap(line => {
      const token = line.startsWith('+')
        ? 'toolDiffAdded'
        : line.startsWith('−')
          ? 'toolDiffRemoved'
          : 'toolOutput';
      const match =
        tool.name === 'Read' ? /^(\d+  )(.*)$/u.exec(line) : undefined;
      const rendered = match
        ? theme.fg('muted', match[1] ?? '') +
          highlightCode(match[2] ?? '', 'typescript').join('\n')
        : theme.fg(token, line);
      return wrapTextWithAnsi(`    ${rendered}`, width - 2);
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
  const variant: DiffVariant =
    scene === 'diff-split'
      ? 'split'
      : scene === 'diff-paired'
        ? 'paired'
        : 'unified';

  for (const [index, message] of messages.entries()) {
    pi.registerMessageRenderer(
      `ui-direction-${index}`,
      (_message, options, theme) => {
        if (message.kind === 'tool')
          return linesComponent(width =>
            toolLines(message.tool, theme, options.expanded, width, variant),
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
  });
}
