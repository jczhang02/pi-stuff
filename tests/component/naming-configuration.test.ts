import {expect, test} from 'bun:test';
import {Effect} from 'effect';
import {readConfiguration} from '../../src/pi/configuration';

test('naming configuration supports manual-only custom-language names', async () => {
  const config = await Effect.runPromise(
    readConfiguration(
      Effect.succeed(
        JSON.stringify({
          naming: {
            automatic: false,
            prompt: '用中文描述当前主任务',
            maxLength: 24,
            model: {provider: 'fixture', id: 'naming'},
          },
        }),
      ),
    ),
  );
  expect(config.naming).toEqual({
    automatic: false,
    prompt: '用中文描述当前主任务',
    maxLength: 24,
    model: {provider: 'fixture', id: 'naming'},
  });
});
