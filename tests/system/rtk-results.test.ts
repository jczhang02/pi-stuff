import {expect, test} from 'bun:test';
import {readdir, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {Schema} from 'effect';
import {launchPi} from './fixtures/pi-terminal';
import {
  ANSI_CLEAN_RESULT,
  ANSI_RESULT,
  ERROR_CLEAN_RESULT,
  ERROR_RESULT,
  MIXED_AFTER,
  MIXED_BEFORE_CLEAN,
  MIXED_DETAILS,
  MIXED_IMAGE_DATA,
  RESULT_USAGE,
} from './fixtures/result-content';

const TextBlock = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
});
const ImageBlock = Schema.Struct({
  type: Schema.Literal('image'),
  data: Schema.String,
  mimeType: Schema.String,
});
const ContentBlock = Schema.Union([TextBlock, ImageBlock]);
const ModelBlock = Schema.Union([
  Schema.Struct({type: Schema.Literal('text'), text: Schema.String}),
  Schema.Struct({type: Schema.Literal('image')}),
]);
const Usage = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  totalTokens: Schema.Number,
  cost: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    cacheRead: Schema.Number,
    cacheWrite: Schema.Number,
    total: Schema.Number,
  }),
});
const ResultDetails = Schema.Struct({
  mode: Schema.Union([Schema.Literal('ansi'), Schema.Literal('mixed')]),
  marker: Schema.String,
  order: Schema.String,
});
const EmptyDetails = Schema.Struct({});
const ResultDetailsOrEmpty = Schema.Union([ResultDetails, EmptyDetails]);
const SessionResultMessage = Schema.Struct({
  role: Schema.Literal('toolResult'),
  toolCallId: Schema.String,
  toolName: Schema.Literal('result_content'),
  content: Schema.Array(ContentBlock),
  details: ResultDetailsOrEmpty,
  usage: Schema.optional(Usage),
  isError: Schema.Boolean,
  timestamp: Schema.Number,
});
const ResultEntry = Schema.Struct({
  type: Schema.Literal('message'),
  id: Schema.String,
  parentId: Schema.Union([Schema.String, Schema.Null]),
  timestamp: Schema.String,
  message: SessionResultMessage,
});

const Truncation = Schema.Struct({
  content: Schema.String,
  truncated: Schema.Boolean,
  truncatedBy: Schema.Union([
    Schema.Literal('lines'),
    Schema.Literal('bytes'),
    Schema.Null,
  ]),
  totalLines: Schema.Number,
  totalBytes: Schema.Number,
  outputLines: Schema.Number,
  outputBytes: Schema.Number,
  lastLinePartial: Schema.Boolean,
  firstLineExceedsLimit: Schema.Boolean,
  maxLines: Schema.Number,
  maxBytes: Schema.Number,
});
const BashDetails = Schema.Struct({
  truncation: Truncation,
  fullOutputPath: Schema.String,
});
const BashResultMessage = Schema.Struct({
  role: Schema.Literal('toolResult'),
  toolCallId: Schema.String,
  toolName: Schema.Literal('bash'),
  content: Schema.Array(ContentBlock),
  details: BashDetails,
  isError: Schema.Boolean,
  timestamp: Schema.Number,
});
const BashEntry = Schema.Struct({
  type: Schema.Literal('message'),
  id: Schema.String,
  parentId: Schema.Union([Schema.String, Schema.Null]),
  timestamp: Schema.String,
  message: BashResultMessage,
});

type ResultMessage = Schema.Schema.Type<typeof SessionResultMessage>;
type BashMessage = Schema.Schema.Type<typeof BashResultMessage>;
type ModelContent = ReadonlyArray<Schema.Schema.Type<typeof ModelBlock>>;

async function readResultMessages(directory: string): Promise<ResultMessage[]> {
  const sessionDirectory = join(directory, 'sessions');
  const files = (await readdir(sessionDirectory, {recursive: true})).filter(
    file => file.endsWith('.jsonl'),
  );
  const results: ResultMessage[] = [];
  for (const file of files) {
    const contents = await readFile(join(sessionDirectory, file), 'utf8');
    for (const line of contents.split('\n')) {
      if (!line.includes('"toolName":"result_content"')) continue;
      const entry = Schema.decodeUnknownSync(ResultEntry)(JSON.parse(line));
      results.push(entry.message);
    }
  }
  return results;
}

async function readBashMessage(directory: string): Promise<BashMessage> {
  const sessionDirectory = join(directory, 'sessions');
  const files = (await readdir(sessionDirectory, {recursive: true})).filter(
    file => file.endsWith('.jsonl'),
  );
  for (const file of files) {
    const contents = await readFile(join(sessionDirectory, file), 'utf8');
    for (const line of contents.split('\n')) {
      if (!line.includes('"toolName":"bash"')) continue;
      const entry = Schema.decodeUnknownSync(BashEntry)(JSON.parse(line));
      return entry.message;
    }
  }
  throw new Error('No Bash tool result was persisted.');
}

function decodeModelContent(serialized: string): ModelContent {
  try {
    return Schema.decodeUnknownSync(Schema.Array(ModelBlock))(
      JSON.parse(serialized),
    );
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return [{type: 'text', text: serialized}];
  }
}

function resultWithMode(
  results: ResultMessage[],
  mode: 'ansi' | 'mixed',
): ResultMessage {
  for (const result of results) {
    const details = Schema.decodeUnknownSync(ResultDetails)(result.details);
    if (details.mode === mode) return result;
  }
  throw new Error(`No result_content result for mode ${mode}.`);
}

test('Final tool results clean ANSI while preserving text, blocks and metadata', async () => {
  const host = await launchPi(
    '{}',
    resolve('tests/system/fixtures/result-content.ts'),
    'web',
  );
  try {
    const ansiModelResult = decodeModelContent(
      await host.invoke('result_content', JSON.stringify({mode: 'ansi'})),
    );
    expect(ansiModelResult).toEqual([{type: 'text', text: ANSI_CLEAN_RESULT}]);
    expect(ANSI_RESULT).toContain('\x1b[31m');
    expect(ANSI_CLEAN_RESULT).not.toContain('\x1b[31m');

    const mixedModelResult = decodeModelContent(
      await host.invoke('result_content', JSON.stringify({mode: 'mixed'})),
    );
    expect(mixedModelResult).toEqual([
      {
        type: 'text',
        text:
          `${MIXED_BEFORE_CLEAN}\n` +
          '(tool image omitted: model does not support images)\n' +
          MIXED_AFTER,
      },
    ]);

    const errorModelResult = decodeModelContent(
      await host.invoke('result_content', JSON.stringify({mode: 'error'})),
    );
    expect(errorModelResult).toEqual([
      {type: 'text', text: ERROR_CLEAN_RESULT},
    ]);
    expect(ERROR_RESULT).toContain('\x1b[31m');
    expect(ERROR_CLEAN_RESULT).not.toContain('\x1b[31m');

    const results = await readResultMessages(host.directory);
    expect(results).toHaveLength(3);
    const ansiSessionResult = resultWithMode(results, 'ansi');
    expect(ansiSessionResult.content).toEqual([
      {type: 'text', text: ANSI_CLEAN_RESULT},
    ]);
    const mixedSessionResult = resultWithMode(results, 'mixed');
    expect(mixedSessionResult.content).toEqual([
      {type: 'text', text: MIXED_BEFORE_CLEAN},
      {type: 'image', data: MIXED_IMAGE_DATA, mimeType: 'image/png'},
      {type: 'text', text: MIXED_AFTER},
    ]);
    expect(mixedSessionResult.details).toEqual(MIXED_DETAILS);
    expect(mixedSessionResult.usage).toEqual(RESULT_USAGE);
    expect(mixedSessionResult.isError).toBe(false);

    const errorSessionResult = results.find(result => result.isError);
    if (errorSessionResult === undefined)
      throw new Error('No error tool result was persisted.');
    expect(errorSessionResult.content).toEqual([
      {type: 'text', text: ERROR_CLEAN_RESULT},
    ]);
    expect(errorSessionResult.isError).toBe(true);
  } finally {
    await host.close();
  }
}, 60000);

test('Final Bash result keeps truncation notice and raw full-output reference', async () => {
  const host = await launchPi(JSON.stringify({rtk: {rewrite: false}}));
  try {
    const command =
      "printf '\\033[31mLONG_OUTPUT_START\\033[0m\\n'; " +
      'for i in $(seq 1 2101); do printf \'\\033[32mLINE_%04d_0123456789012345678901234567890123456789\\033[0m\\n\' "$i"; done; ' +
      "printf '\\033[31mLONG_OUTPUT_END\\033[0m\\n'";
    const modelResult = decodeModelContent(
      await host.invoke('bash', JSON.stringify({command})),
    );
    expect(modelResult).toHaveLength(1);
    const modelBlock = modelResult[0];
    if (modelBlock?.type !== 'text')
      throw new Error('Expected the Bash result to contain text.');
    expect(modelBlock.text).toContain('LONG_OUTPUT_END');
    expect(modelBlock.text).toContain('50.0KB limit');
    expect(modelBlock.text).toContain('Full output: ');
    expect(modelBlock.text).not.toContain('\x1b[31m');
    expect(modelBlock.text).not.toContain('\x1b[32m');

    const sessionResult = await readBashMessage(host.directory);
    expect(sessionResult.isError).toBe(false);
    const sessionBlock = sessionResult.content[0];
    if (sessionBlock?.type !== 'text')
      throw new Error('Expected the persisted Bash result to contain text.');
    expect(sessionBlock.text).toBe(modelBlock.text);
    expect(sessionBlock.text).toContain('Full output: ');
    expect(sessionBlock.text).not.toContain('\x1b[31m');
    expect(sessionBlock.text).not.toContain('\x1b[32m');

    const truncation = sessionResult.details.truncation;
    expect(truncation.truncated).toBe(true);
    expect(truncation.totalLines).toBeGreaterThan(2000);
    expect(truncation.totalBytes).toBeGreaterThan(50 * 1024);
    expect(truncation.maxLines).toBe(2000);
    expect(truncation.maxBytes).toBe(50 * 1024);
    expect(sessionResult.details.fullOutputPath).toContain('/tmp/');
    const rawFullOutput = await readFile(
      sessionResult.details.fullOutputPath,
      'utf8',
    );
    expect(rawFullOutput).toContain('\x1b[31mLONG_OUTPUT_START\x1b[0m');
    expect(rawFullOutput).toContain('\x1b[32mLINE_0001_');
    expect(rawFullOutput).toContain('\x1b[31mLONG_OUTPUT_END\x1b[0m');
  } finally {
    await host.close();
  }
}, 60000);
