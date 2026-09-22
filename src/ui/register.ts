import {
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type BashToolOptions,
} from '@earendil-works/pi-coding-agent';
import {createBashDisplay} from './bash';

export function registerUi(pi: ExtensionAPI): void {
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) return;
    // Only replace a native definition. Other extensions retain their renderers.
    const bash = pi.getAllTools().find(tool => tool.name === 'bash');
    if (bash?.sourceInfo.source !== 'builtin') return;
    const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    });
    const options: BashToolOptions = {};
    const prefix = settings.getShellCommandPrefix();
    const shell = settings.getShellPath();
    if (prefix !== undefined) options.commandPrefix = prefix;
    if (shell !== undefined) options.shellPath = shell;
    pi.registerTool(createBashDisplay(ctx.cwd, options));
  });
}
