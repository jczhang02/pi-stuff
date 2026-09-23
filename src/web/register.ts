import type {Api, Model} from '@earendil-works/pi-ai';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {registerTool, type ToolSwitches} from '../pi/tool-switches';
import {exaProvider, resolveExa} from './exa-auth';
import {resolveOpenAI, selectSearchModel} from './openai-auth';
import {network} from './transport';
import {createWebTools} from './tools';
import type {WebSettings} from './settings';

export function registerWeb(
  pi: ExtensionAPI,
  settings: WebSettings,
  switches: ToolSwitches | undefined,
  decorate?: (tools: ReturnType<typeof createWebTools>) => void,
): void {
  pi.registerProvider(exaProvider);
  let model: Model<Api> | undefined;
  let web: ReturnType<typeof createWebTools> | undefined;
  pi.on('model_select', event => {
    model = event.model;
  });
  pi.on('session_start', (_event, ctx) => {
    web?.clear();
    model = ctx.model;
    // Validate explicit model configuration before exposing any Pi Stuff tool.
    selectSearchModel(ctx.modelRegistry, model, settings);
    web = createWebTools(network, settings, {
      exa: () => resolveExa(ctx.modelRegistry),
      openai: () => resolveOpenAI(ctx.modelRegistry, model, settings),
    });
    if (ctx.hasUI) decorate?.(web);
    registerTool(pi, switches, web.webSearch);
    registerTool(pi, switches, web.fetchContent);
    registerTool(pi, switches, web.getSearchContent);
  });
  pi.on('session_shutdown', () => {
    web?.clear();
  });
}
