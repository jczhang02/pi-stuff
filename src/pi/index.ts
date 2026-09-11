import type {Api, Model} from '@earendil-works/pi-ai';
import {getAgentDir, type ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';
import {registerTool} from '../tool-switches';
import {createWebTools} from '../web';
import {ConfigurationError, readConfiguration} from './configuration';
import {network} from './network';
import {resolveOpenAI, selectSearchModel} from './openai';

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
  let model: Model<Api> | undefined;
  let web: ReturnType<typeof createWebTools> | undefined;
  pi.on('model_select', event => {
    model = event.model;
  });
  pi.on('session_start', (_event, ctx) => {
    web?.clear();
    model = ctx.model;
    const settings = configuration.web ?? {};
    // Validate explicit model configuration before exposing any Pi Stuff tool.
    selectSearchModel(ctx.modelRegistry, model, settings);
    web = createWebTools(network, settings, {
      exaKey: process.env.EXA_API_KEY?.trim(),
      openai: () => resolveOpenAI(ctx.modelRegistry, model, settings),
    });
    registerTool(pi, configuration.tools, web.webSearch);
    registerTool(pi, configuration.tools, web.fetchContent);
    registerTool(pi, configuration.tools, web.getSearchContent);
  });
  pi.on('session_shutdown', () => {
    web?.clear();
  });
}
