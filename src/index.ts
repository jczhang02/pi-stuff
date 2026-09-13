import {getAgentDir, type ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Effect, Schema} from 'effect';
import {ConfigurationError, readConfiguration} from './pi/configuration';
import {registerWeb} from './web/register';

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
