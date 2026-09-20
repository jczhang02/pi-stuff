// Future UI preview only. Static fixtures rendered inside the isolated Pi host.
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {
  Box,
  MouseRegion,
  Text,
  truncateToWidth,
  type TUI,
} from '@earendil-works/pi-tui';
import {getFutureItems} from './future-scenes';
import {renderFutureMessage} from './future-messages';
import {renderFutureTool} from './future-tools';

export default function futureUi(pi: ExtensionAPI): void {
  const name = process.env.PI_UI_SCENE ?? 'future-overview-read';
  const items = getFutureItems(name);
  let host: TUI | undefined;
  for (const [index, item] of items.entries()) {
    let localExpanded =
      item.kind === 'tool'
        ? item.tool.expanded === true
        : item.kind === 'assistant'
          ? item.hideThinkingBlock === false
          : 'expanded' in item && item.expanded === true;
    let globalExpanded = false;
    pi.registerMessageRenderer(
      `future-ui-${index}`,
      (_message, options, theme) => {
        if (options.expanded !== globalExpanded) {
          globalExpanded = options.expanded;
          localExpanded = globalExpanded;
        }
        const render = () => {
          const component =
            item.kind === 'tool'
              ? renderFutureTool(item.tool, theme, localExpanded)
              : renderFutureMessage(item, theme, localExpanded);
          if (!component)
            throw new Error(`Missing future renderer for ${item.kind}`);
          return component;
        };
        let child = render();
        const region = new MouseRegion(
          {
            render: width => child.render(Math.max(1, width)),
            invalidate() {
              child.invalidate();
            },
          },
          event => {
            if (
              event.type !== 'click' ||
              event.button !== 'left' ||
              ![
                'tool',
                'assistant',
                'bash',
                'skill',
                'compaction',
                'branch',
              ].includes(item.kind)
            )
              return undefined;
            localExpanded = !localExpanded;
            child = render();
            host?.requestRender();
            return {handled: true};
          },
        );
        const box = new Box(1, 0);
        box.addChild(region);
        return box;
      },
    );
  }
  pi.on('session_start', (_event, ctx) => {
    ctx.ui.setHeader(tui => {
      host = tui;
      return new Text('', 0, 0);
    });
    ctx.ui.setFooter((_tui, theme) => ({
      render: width => [
        truncateToWidth(
          theme.fg('muted', ' pi-stuff  ·  fix/search-pagination'),
          width,
        ),
        truncateToWidth(
          ` ${theme.fg('text', 'gpt-5.4')} ${theme.fg('dim', '· high  ·  12% context · $0.16')}`,
          width,
        ),
      ],
      invalidate() {},
    }));
    items.forEach((_item, index) =>
      pi.sendMessage({
        customType: `future-ui-${index}`,
        content: '',
        display: true,
      }),
    );
  });
}
