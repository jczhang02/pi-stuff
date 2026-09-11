import {expect, test} from 'bun:test';
import {Effect} from 'effect';
import {Type} from 'typebox';
import {registerTool} from '../../src/tool-switches';
import {readConfiguration} from '../../src/pi/configuration';

test('global switches omit only disabled tools and defaults permit future tools', async () => {
  const config = await Effect.runPromise(
    readConfiguration(Effect.succeed('{"tools":{"fetch_content":false}}')),
  );
  const names: string[] = ['unrelated'];
  const host = {
    registerTool: (tool: {name: string}) => {
      names.push(tool.name);
    },
  };
  for (const name of [
    'web_search',
    'fetch_content',
    'get_search_content',
    'future_tool',
  ]) {
    registerTool(host, config.tools, {
      name,
      label: name,
      description: name,
      parameters: Type.Object({}),
      execute: async () => ({content: [], details: undefined}),
    });
  }
  expect(names).toEqual([
    'unrelated',
    'web_search',
    'get_search_content',
    'future_tool',
  ]);
});

test('missing configuration uses defaults, while invalid explicit values fail visibly', async () => {
  expect(
    await Effect.runPromise(readConfiguration(Effect.succeed(undefined))),
  ).toEqual({});
  for (const source of [
    'null',
    '{',
    '{"tools":{"fetch_content":"no"}}',
    '{"web":{"provider":"other"}}',
    '{"web":{"openaiModel":{"provider":"openai"}}}',
  ]) {
    await expect(
      Effect.runPromise(readConfiguration(Effect.succeed(source))),
    ).rejects.toThrow('pi-stuff.json');
  }
});
