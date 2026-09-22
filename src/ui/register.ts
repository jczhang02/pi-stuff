import {
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type BashToolOptions,
} from '@earendil-works/pi-coding-agent';
import {createBashDisplay} from './bash';
import {createWriteDisplay} from './write';
import {createEditDisplay} from './edit';
import type {UiSettings} from './settings';

export function registerUi(pi: ExtensionAPI, settings: UiSettings): void {
  if (settings.enabled === false) return;
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) return;
    // Only replace a native definition. Other extensions retain their renderers.
    const tools = pi.getAllTools();
    if (
      tools.some(
        tool => tool.name === 'write' && tool.sourceInfo.source === 'builtin',
      )
    )
      pi.registerTool(createWriteDisplay(ctx.cwd));
    if (
      tools.some(
        tool => tool.name === 'edit' && tool.sourceInfo.source === 'builtin',
      )
    )
      pi.registerTool(createEditDisplay(ctx.cwd));
    const bash = tools.find(tool => tool.name === 'bash');
    if (bash?.sourceInfo.source !== 'builtin') return;
    const hostSettings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    });
    const options: BashToolOptions = {};
    const prefix = hostSettings.getShellCommandPrefix();
    const shell = hostSettings.getShellPath();
    if (prefix !== undefined) options.commandPrefix = prefix;
    if (shell !== undefined) options.shellPath = shell;
    pi.registerTool(createBashDisplay(ctx.cwd, options, settings));
  });
}
