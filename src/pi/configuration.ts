import {Effect, Schema} from 'effect';
import {ToolSwitches} from './tool-switches';
import {WebSettings} from '../web/settings';
import {RtkSettings} from '../rtk/settings';
import {StatuslineSettings} from '../statusline/settings';
import {NamingSettings} from '../naming/settings';

export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()(
  'ConfigurationError',
  {
    message: Schema.String,
  },
) {}

const Configuration = Schema.Struct({
  tools: Schema.optional(ToolSwitches),
  web: Schema.optional(WebSettings),
  rtk: Schema.optional(RtkSettings),
  naming: Schema.optional(NamingSettings),
  statusline: Schema.optional(StatuslineSettings),
});

export function readConfiguration(
  source: Effect.Effect<string | undefined, ConfigurationError>,
) {
  return source.pipe(
    Effect.flatMap(text =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(Configuration), {
        onExcessProperty: 'error',
      })(text ?? '{}'),
    ),
    Effect.mapError(
      () =>
        new ConfigurationError({
          message:
            'Invalid or unreadable pi-stuff.json. Correct it and /reload; Pi Stuff tools are unavailable.',
        }),
    ),
  );
}
