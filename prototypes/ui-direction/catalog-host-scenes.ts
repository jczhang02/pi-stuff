// Host-only compositions reconstructed with the same public Pi primitives.
// These fixtures do not install commands or implement production behavior.
import {
  DynamicBorder,
  getMarkdownTheme,
  type ExtensionAPI,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Container,
  Loader,
  Markdown,
  Spacer,
  Text,
  type Component,
  type TUI,
} from '@earendil-works/pi-tui';

export const hostScenes = [
  {
    name: 'catalog-host-command-info',
    title: 'Command text output',
    expectedToken: 'Session Info',
    category: 'conditional host output',
    source: 'Pi handleSessionCommand Text composition, reconstructed fixture',
  },
  {
    name: 'catalog-host-command-markdown',
    title: 'Command Markdown and startup changelog',
    expectedToken: "What's New",
    category: 'conditional host output',
    source:
      'Pi handleChangelogCommand / handleHotkeysCommand composition, reconstructed fixture',
  },
  {
    name: 'catalog-host-updates',
    title: 'Version and package update notices',
    expectedToken: 'Update Available',
    category: 'conditional host output',
    source:
      'Pi showNewVersionNotification / showPackageUpdateNotification composition, reconstructed fixture',
  },
  {
    name: 'catalog-host-activity',
    title: 'Working, retry and compaction indicators',
    expectedToken: 'Summarizing branch',
    category: 'adjacent live activity',
    source:
      'Pi StatusIndicator uses Loader; frozen Loader samples, not transcript placement',
  },
  {
    name: 'catalog-host-custom-entry',
    title: 'Custom entry renderer and failure fallback',
    expectedToken: 'renderer failed',
    category: 'optional extension output',
    source: 'Pi registerEntryRenderer + appendEntry, actual host fallback',
  },
  {
    name: 'catalog-host-earendil',
    title: 'Conditional Earendil announcement',
    expectedToken: 'pi has joined Earendil',
    category: 'conditional appendix',
    source: 'Pi /dementedelves command, actual host component',
    command: '/dementedelves',
  },
  {
    name: 'catalog-host-armin',
    title: 'Conditional Armin animation',
    expectedToken: 'ARMIN SAYS HI',
    category: 'conditional appendix',
    source: 'Pi /arminsayshi command, actual host component',
    command: '/arminsayshi',
  },
  {
    name: 'catalog-host-daxnuts',
    title: 'Conditional OpenCode / Kimi announcement',
    expectedToken: 'Free Kimi K2.5',
    category: 'conditional appendix',
    source:
      'Pi opencode + kimi-k2.5 model selection condition, actual host component',
    command: '/model opencode/kimi-k2.5',
  },
] as const;

function commandInfo(theme: Theme): Component {
  const label = (name: string, value: string) =>
    `${theme.fg('dim', name + ':')} ${value}`;
  return new Text(
    [
      theme.bold('Session Info'),
      '',
      label('File', 'In-memory'),
      label('ID', 'preview-session'),
      '',
      theme.bold('Messages'),
      label('Total', '8'),
      label('User', '2'),
      label('Assistant', '3'),
      label('Tools', '3 calls, 3 results'),
      '',
      theme.bold('Tokens'),
      label('Input', '1,024'),
      label('Output', '256'),
      label('Total', '1,280'),
    ].join('\n'),
    1,
    0,
  );
}

function markdownCommands(theme: Theme): Component {
  const container = new Container();
  container.addChild(new DynamicBorder(text => theme.fg('border', text)));
  container.addChild(
    new Text(theme.bold(theme.fg('accent', "What's New")), 1, 0),
  );
  container.addChild(new Spacer(1));
  container.addChild(
    new Markdown(
      '### Preview release\n\n- Preserve cursor order.\n- Show code in tool results.',
      1,
      1,
      getMarkdownTheme(),
    ),
  );
  container.addChild(new DynamicBorder(text => theme.fg('border', text)));
  container.addChild(new Spacer(1));
  container.addChild(new DynamicBorder(text => theme.fg('border', text)));
  container.addChild(
    new Text(theme.bold(theme.fg('accent', 'Keyboard Shortcuts')), 1, 0),
  );
  container.addChild(
    new Markdown(
      '| Key | Action |\n| --- | --- |\n| Ctrl+O | Expand tool output |\n| Esc | Interrupt |',
      1,
      1,
      getMarkdownTheme(),
    ),
  );
  container.addChild(new DynamicBorder(text => theme.fg('border', text)));
  return container;
}

function updates(theme: Theme): Component {
  const container = new Container();
  for (const [title, message] of [
    [
      'Update Available',
      'New version preview-next is available. Run pi update\nChangelog: https://pi.dev/changelog',
    ],
    [
      'Package Updates Available',
      'Package updates are available. Run pi update --extensions\nPackages:\n- preview-package',
    ],
  ]) {
    container.addChild(new Spacer(1));
    container.addChild(new DynamicBorder(text => theme.fg('warning', text)));
    container.addChild(
      new Text(
        theme.bold(theme.fg('warning', title ?? '')) +
          '\n' +
          theme.fg('muted', message ?? ''),
        1,
        0,
      ),
    );
    container.addChild(new DynamicBorder(text => theme.fg('warning', text)));
  }
  return container;
}

function activity(theme: Theme, tui: TUI): Component {
  const container = new Container();
  for (const message of [
    'Working...',
    'Retrying (1/3) in 2s... (esc to cancel)',
    'Compacting context... (esc to cancel)',
    'Auto-compacting... (esc to cancel)',
    'Context overflow detected, Auto-compacting... (esc to cancel)',
    'Summarizing branch... (esc to cancel)',
  ]) {
    const loader = new Loader(
      tui,
      text =>
        theme.fg(message.startsWith('Retry') ? 'warning' : 'accent', text),
      text => theme.fg('muted', text),
      message,
    );
    loader.stop();
    container.addChild(loader);
  }
  return container;
}

export default function hostCatalog(pi: ExtensionAPI): void {
  const scene = hostScenes.find(item => item.name === process.env.PI_UI_SCENE);
  if (!scene) throw new Error('Unknown host catalog scene');
  let tui: TUI | undefined;
  pi.registerMessageRenderer(
    'catalog-host-composition',
    (_message, _options, theme) => {
      switch (scene.name) {
        case 'catalog-host-command-info':
          return commandInfo(theme);
        case 'catalog-host-command-markdown':
          return markdownCommands(theme);
        case 'catalog-host-updates':
          return updates(theme);
        case 'catalog-host-activity':
          if (!tui) throw new Error('Host TUI is not mounted');
          return activity(theme, tui);
        default:
          return undefined;
      }
    },
  );
  pi.registerEntryRenderer(
    'preview-entry',
    (_entry, _options, theme) =>
      new Text(
        theme.fg('muted', 'Extension entry: pagination review recorded.'),
        1,
        0,
      ),
  );
  pi.registerEntryRenderer('preview-entry-error', () => {
    throw new Error('Fixture entry renderer failed');
  });
  pi.on('session_start', (_event, ctx) => {
    ctx.ui.setHeader(host => {
      tui = host;
      return new Text('', 0, 0);
    });
    if ('command' in scene) return;
    if (scene.name === 'catalog-host-custom-entry') {
      pi.appendEntry('preview-entry', {review: 'pagination'});
      pi.appendEntry('preview-entry-error', {});
    } else {
      pi.sendMessage({
        customType: 'catalog-host-composition',
        content: '',
        display: true,
      });
    }
  });
}
