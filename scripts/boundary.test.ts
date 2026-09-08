import {afterEach, beforeEach, expect, test} from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {Effect, Result} from 'effect';
import {checkRepo, checkTemplate, loadJson, loadYaml} from './check-repo';
import {readText} from './parse';

const ROOT = resolve(import.meta.dir, '..');
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'pi-boundary-'));
  mkdirSync(resolve(directory, '.github'));
  writeFileSync(
    resolve(directory, '.github/labels.json'),
    readFileSync(resolve(ROOT, '.github/labels.json')),
  );
});
afterEach(() => rmSync(directory, {recursive: true, force: true}));

const METADATA = [
  '.inf',
  '.nan',
  '!!timestamp 2026-01-01',
  '!!binary aGVsbG8=',
  '!!set {a: null}',
  '!!omap [a: 1]',
  '&self {again: *self}',
];
for (const metadata of METADATA) {
  test(`ignored template YAML accepts ${metadata}`, () => {
    expect(() =>
      checkTemplate(
        `---\nname: Bug\nabout: Report\nlabels: [needs-triage]\nmetadata: ${metadata}\n---\n`,
        new Set(['needs-triage']),
      ),
    ).not.toThrow();
  });
  test(`generic tracked YAML accepts ${metadata}`, () => {
    writeFileSync(resolve(directory, 'data.yml'), `metadata: ${metadata}\n`);
    expect(checkRepo(directory, ['data.yml'])).toEqual([]);
  });
}

test('generic repository JSON permits numeric overflow', () => {
  expect(() => loadJson('{"unused":1e400}')).not.toThrow();
  writeFileSync(resolve(directory, 'data.json'), '{"unused":1e400}\n');
  expect(checkRepo(directory, ['data.json'])).toEqual([]);
});

test('repository I/O diagnostics retain filesystem details', () => {
  const path = resolve(directory, 'missing.md');
  let expected = '';
  try {
    readFileSync(path);
  } catch (error) {
    if (error instanceof Error) expected = error.message;
  }
  expect(expected).toContain('ENOENT');
  expect(checkRepo(directory, ['missing.md'])).toEqual([
    `missing.md: ${expected}`,
  ]);
  const result = Effect.runSync(Effect.result(readText(path)));
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.message).toBe(expected);
});

test('repository UTF-8 diagnostics retain decoder details', () => {
  const bytes = Buffer.from([0xff]);
  writeFileSync(resolve(directory, 'invalid.md'), bytes);
  let expected = '';
  try {
    new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
  } catch (error) {
    if (error instanceof Error) expected = error.message;
  }
  expect(expected).not.toBe('');
  expect(checkRepo(directory, ['invalid.md'])).toEqual([
    `invalid.md: ${expected}`,
  ]);
});

for (const [name, source, code, diagnostic] of [
  [
    'unused overflow in draft event',
    '{"pull_request":{"draft":true},"unused":1e400}',
    0,
    '',
  ],
  [
    'native duplicate event keys',
    '{"pull_request":{"draft":false},"pull_request":{"draft":true}}',
    0,
    '',
  ],
  [
    'native duplicate draft keys',
    '{"pull_request":{"draft":false,"draft":true}}',
    0,
    '',
  ],
  [
    'syntax redaction category',
    'private-invalid-payload',
    1,
    'Cannot read PR evidence input (SyntaxError).\n',
  ],
] as const) {
  test(name, () => {
    const path = resolve(directory, 'event.json');
    writeFileSync(path, source);
    const result = Bun.spawnSync(
      [process.execPath, resolve(ROOT, 'scripts/check-pr.ts')],
      {
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: path,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    expect(result.exitCode).toBe(code);
    expect(result.stderr.toString()).toBe(diagnostic);
  });
}

test('label bootstrap leaves UTF-8 diagnostics in the file collection pass', () => {
  const labels = readFileSync(
    resolve(ROOT, '.github/labels.json'),
    'utf8',
  ).replace('"name":', '"unused":"__INVALID__","name":');
  const [before, after] = labels.split('__INVALID__');
  writeFileSync(
    resolve(directory, '.github/labels.json'),
    Buffer.concat([
      Buffer.from(before!),
      Buffer.from([0xff]),
      Buffer.from(after!),
    ]),
  );
  expect(checkRepo(directory, ['.github/labels.json'])).toEqual([
    '.github/labels.json: The encoded data was not valid for encoding utf-8',
  ]);
});

test('PR read errors redact filesystem and decoder details', () => {
  for (const name of ['missing-private-path.md', 'invalid-private-path.md']) {
    const path = resolve(directory, name);
    if (name.startsWith('invalid')) writeFileSync(path, Buffer.from([0xff]));
    const result = Bun.spawnSync(
      [
        process.execPath,
        resolve(ROOT, 'scripts/check-pr.ts'),
        '--body-file',
        path,
      ],
      {stdout: 'pipe', stderr: 'pipe'},
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toBe(
      'Cannot read PR evidence input (InputError).\n',
    );
  }
});

test('YAML alias expansion is still bounded', () => {
  const source =
    'a: &a [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]\n';
  expect(() => loadYaml(source)).toThrow(/alias count/i);
});
