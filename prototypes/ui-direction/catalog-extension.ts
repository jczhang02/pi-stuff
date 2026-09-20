// Throwaway native Pi 0.85.1 conversation-output catalog.
// All messages and tool results are static fixtures. No executor is called.
import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {createWebTools} from '../../src/web/tools';
import {Text, type Component, type TUI} from '@earendil-works/pi-tui';
import {
  catalogScenes,
  getCatalogScene,
  type CatalogItem,
  type CatalogScene,
  type CatalogToolFixture,
  type CatalogToolName,
} from './catalog-scenes';

const CATALOG_MESSAGE_TYPE = 'catalog-native-item';

const webTools = createWebTools({
  request() {
    throw new Error('Offline catalog must never execute a network request.');
  },
});

function nativeToolDefinition(
  name: CatalogToolName,
  cwd: string,
  toolName: string,
) {
  switch (name) {
    case 'read':
      return createReadToolDefinition(cwd);
    case 'write':
      return createWriteToolDefinition(cwd);
    case 'edit':
      return createEditToolDefinition(cwd);
    case 'bash':
      return createBashToolDefinition(cwd);
    case 'grep':
      return createGrepToolDefinition(cwd);
    case 'find':
      return createFindToolDefinition(cwd);
    case 'ls':
      return createLsToolDefinition(cwd);
    case 'generic':
      switch (toolName) {
        case 'web_search':
          return webTools.webSearch;
        case 'fetch_content':
          return webTools.fetchContent;
        case 'get_search_content':
          return webTools.getSearchContent;
        default:
          return undefined;
      }
  }
}

function requireHostTui(tui: TUI | undefined): TUI {
  if (tui === undefined) {
    throw new Error(
      'Native catalog renderer was created before the Pi TUI mounted.',
    );
  }
  return tui;
}

function requireCatalogCwd(cwd: string | undefined): string {
  if (cwd === undefined) {
    throw new Error(
      'Native catalog renderer was created before the Pi cwd mounted.',
    );
  }
  return cwd;
}

function renderTool(
  fixture: CatalogToolFixture,
  options: {readonly expanded: boolean; readonly outputPad: number},
  tui: TUI,
  cwd: string,
): Component {
  const component = new ToolExecutionComponent(
    fixture.name,
    fixture.callId,
    fixture.args,
    {showImages: true},
    nativeToolDefinition(fixture.definition, cwd, fixture.name),
    tui,
    cwd,
  );

  component.markExecutionStarted();
  // The edit renderer computes previews from the real file system when arguments
  // become complete. Its result renderer is enough for this static diff fixture.
  if (fixture.definition !== 'edit') {
    component.setArgsComplete();
  }
  if (fixture.result !== undefined) {
    component.updateResult(
      {
        content: [...fixture.result],
        details: fixture.details,
        isError: fixture.isError === true,
      },
      fixture.isPartial === true,
    );
  }
  component.setExpanded(options.expanded || fixture.expanded === true);
  return component;
}

function renderItem(
  item: CatalogItem,
  options: {readonly expanded: boolean; readonly outputPad: number},
  tui: TUI,
  cwd: string,
): Component | undefined {
  switch (item.kind) {
    case 'user':
      return new UserMessageComponent(
        item.text,
        getMarkdownTheme(),
        options.outputPad,
      );
    case 'assistant':
      return new AssistantMessageComponent(
        item.message,
        item.hideThinkingBlock === true,
        getMarkdownTheme(),
        'Thinking...',
        options.outputPad,
      );
    case 'custom': {
      const component = new CustomMessageComponent(
        item.message,
        undefined,
        getMarkdownTheme(),
        options.outputPad,
      );
      component.setExpanded(options.expanded || item.expanded === true);
      return component;
    }
    case 'tool':
      return renderTool(item.tool, options, tui, cwd);
    case 'bash': {
      const component = new BashExecutionComponent(
        item.command,
        tui,
        item.excludeFromContext === true,
      );
      component.appendOutput(item.output);
      component.setComplete(
        item.exitCode,
        item.cancelled,
        item.truncation,
        item.fullOutputPath,
      );
      component.setExpanded(options.expanded || item.expanded === true);
      return component;
    }
    case 'compaction': {
      const component = new CompactionSummaryMessageComponent(
        item.message,
        getMarkdownTheme(),
      );
      component.setExpanded(options.expanded || item.expanded === true);
      return component;
    }
    case 'branch': {
      const component = new BranchSummaryMessageComponent(
        item.message,
        getMarkdownTheme(),
      );
      component.setExpanded(options.expanded || item.expanded === true);
      return component;
    }
    case 'skill': {
      const component = new SkillInvocationMessageComponent(
        item.block,
        getMarkdownTheme(),
      );
      component.setExpanded(options.expanded || item.expanded === true);
      return component;
    }
    case 'notice':
      // Notices are emitted through the host UI API during session_start.
      return undefined;
    case 'extension-error':
      return undefined;
  }
}

function selectedScene(name: string): CatalogScene {
  const scene = catalogScenes.find(candidate => candidate.name === name);
  if (scene === undefined) throw new Error(`Unknown catalog scene: ${name}`);
  return scene;
}

export default function catalogExtension(pi: ExtensionAPI): void {
  const sceneName = process.env.PI_UI_SCENE ?? catalogScenes[0].name;
  const scene = selectedScene(sceneName);
  const items = getCatalogScene(scene.name);
  let hostTui: TUI | undefined;
  let cwd: string | undefined;

  pi.registerMessageRenderer<CatalogItem>(
    CATALOG_MESSAGE_TYPE,
    (message, options) => {
      if (message.details === undefined) return undefined;
      return renderItem(
        message.details,
        options,
        requireHostTui(hostTui),
        requireCatalogCwd(cwd),
      );
    },
  );

  pi.on('session_start', (_event, ctx: ExtensionContext) => {
    cwd = ctx.cwd;
    // setHeader invokes the factory synchronously with Pi's live TUI. The blank
    // native Text keeps quiet startup compact while leaving editor and footer native.
    ctx.ui.setHeader(tui => {
      hostTui = tui;
      return new Text('', 0, 0);
    });

    const extensionError = items.find(item => item.kind === 'extension-error');
    if (extensionError?.kind === 'extension-error') {
      throw new Error(extensionError.message);
    }

    for (const item of items) {
      if (item.kind === 'notice') {
        ctx.ui.notify(item.message, item.type);
      }
    }

    for (const item of items) {
      if (item.kind === 'notice' || item.kind === 'extension-error') continue;
      pi.sendMessage({
        customType: CATALOG_MESSAGE_TYPE,
        content: '',
        display: true,
        details: item,
      });
    }
  });
}
