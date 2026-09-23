import {expect, test} from 'bun:test';
import {Effect} from 'effect';
import {readConfiguration} from '../../src/pi/configuration';

test.each([
  {automatic: 'yes'},
  {maxLength: 0},
  {maxLength: -1},
  {maxLength: 1.5},
  {prompt: ''},
  {prompt: '  '},
  {model: {provider: '', id: 'x'}},
  {model: {provider: 'x', id: ' '}},
  {extra: true},
])(
  'invalid naming configuration produces the existing actionable diagnostic: %j',
  async naming => {
    const error = await Effect.runPromise(
      Effect.flip(readConfiguration(Effect.succeed(JSON.stringify({naming})))),
    );
    expect(error.message).toContain('Correct it and /reload');
  },
);

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
