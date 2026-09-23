import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {Effect, Schema} from 'effect';
import {createWebTools} from '../../../src/web/tools';
import {displayWebTools} from '../../../src/ui/web';

// Keep real search decoding, tool execution and presentation. Only the provider
// transport and credentials are deterministic in this focused host fixture.
export default function (pi: ExtensionAPI) {
  const web = createWebTools(
    {
      request: request =>
        Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Struct({query: Schema.String})),
        )(request.body).pipe(
          Effect.orDie,
          Effect.map(({query}) =>
            Response.json({
              results:
                query === 'empty'
                  ? []
                  : [
                      {
                        url: 'https://example.com/pagination',
                        title: 'Pagination reference',
                        highlights: ['Follow the next cursor.'],
                      },
                    ],
            }),
          ),
        ),
    },
    {provider: 'exa'},
    {
      exa: () => Effect.succeed('fixture-credential'),
      openai: () => Effect.succeed(undefined),
    },
  );
  displayWebTools(web);
  // A distinct test entry avoids Pi's cross-extension name precedence. The
  // production tool's actual execute/render functions remain the ones tested.
  pi.on('session_start', () =>
    pi.registerTool({...web.webSearch, name: 'fixture_search'}),
  );
  pi.on('session_shutdown', () => web.clear());
}
