import {
  FooterComponent,
  getAgentDir,
  type AgentSession,
  type ExtensionAPI,
  type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import {Container, type Component, type TUI} from '@earendil-works/pi-tui';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';
import {ConfigurationError, readConfiguration} from './src/pi/configuration';
import {registerWeb} from './src/web/register';
import {createPrototypeFleet} from './src/subagents/prototype-runtime';
import {FleetTree} from './src/subagents/prototype-tree';
import {MainEditor} from './src/subagents/prototype-editor';

// Throwaway host composition, used only by tools/subagent-prototype.ts.
export function createSubagentPrototype(
  getSession: () => AgentSession,
  scenario: string,
  agentDir: string,
  cleanup: () => Promise<void>,
): ExtensionFactory {
  return pi => {
    let tree: FleetTree | undefined;
    let stop: (() => Promise<void>) | undefined;
    pi.registerShortcut('alt+a', {
      description: 'Focus the subagent tree',
      handler: async () => tree?.enter(),
    });
    pi.registerCommand('agents', {
      description: 'Inspect and control subagent tasks',
      handler: async () => tree?.enter(),
    });
    pi.on('session_start', async (_event, ctx) => {
      let terminal: TUI | undefined;
      let mainInput: Component | null = null;
      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        const editor = new MainEditor(tui, theme, keybindings, {
          embedWorkingStatus: true,
        });
        mainInput = editor;
        return editor;
      });
      const fleet = await createPrototypeFleet(
        ctx.cwd,
        agentDir,
        scenario,
        () => terminal?.requestRender(),
        (message, kind) => ctx.ui.notify(message, kind),
      );
      stop = () => fleet.stop();
      ctx.ui.setFooter((tui, theme, footerData) => {
        terminal = tui;
        const footer = new FooterComponent(getSession(), footerData);
        footer.setAutoCompactEnabled(false);
        tree = new FleetTree(
          tui,
          theme,
          fleet,
          () => {
            tui.setFocus(mainInput);
            tui.requestRender();
          },
          message => ctx.ui.notify(message, 'error'),
        );
        const container = new Container();
        container.addChild(footer);
        container.addChild(tree);
        return container;
      });
      ctx.ui.setEditorText('Also review cancellation during startup.');
      fleet.start();
    });
    pi.on('session_shutdown', async event => {
      await stop?.();
      tree?.dispose();
      if (event.reason === 'quit') await cleanup();
    });
  };
}

export default async function (pi: ExtensionAPI) {
  const configuration = await Effect.runPromise(
    readConfiguration(
      Effect.tryPromise({
        try: () => readFile(join(getAgentDir(), 'pi-stuff.json'), 'utf8'),
        catch: error =>
          Schema.is(Schema.Struct({code: Schema.Literal('ENOENT')}))(error)
            ? ('missing' as const)
            : new ConfigurationError({message: 'Cannot read pi-stuff.json.'}),
      }).pipe(
        Effect.catch(error =>
          error === 'missing' ? Effect.succeed(undefined) : Effect.fail(error),
        ),
      ),
    ),
  );
  registerWeb(pi, configuration.web ?? {}, configuration.tools);
}
