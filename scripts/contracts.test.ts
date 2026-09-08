import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Effect, Result, Schema} from 'effect';
import {
  BodyInput,
  LabelInput,
  PackageInput,
  PREvent,
  WorkflowInput,
} from './contracts';
import {checkBody, checkEvent} from './check-pr';
import {
  checkLabels,
  checkTemplate,
  checkToolchain,
  checkWorkflow,
} from './check-repo';
import {decodeEventJson, decodeJson, decodeYaml, InputError} from './parse';
import {workflowFixture} from './fixtures';

const ROOT = resolve(import.meta.dir, '..');
const WORKFLOW = readFileSync(
  resolve(ROOT, '.github/workflows/ci.yml'),
  'utf8',
);

test('aliased and independent jobs retain their distinct diagnostic order', () => {
  const malformed = WORKFLOW.replace(
    'run: bun run check:pr',
    'run: echo omitted',
  ).replace(/actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@v4');
  const aliased =
    malformed.replace('  checks:\n', '  earlier: &shared\n') +
    '  checks: *shared\n';
  const jobs = malformed.split('jobs:\n')[1];
  expect(jobs).toBeDefined();
  const independent = malformed.replace('  checks:\n', '  earlier:\n') + jobs;
  for (const [source, diagnostic] of [
    [aliased, 'checks must run bun run check:pr'],
    [independent, 'external actions must be pinned'],
  ] as const) {
    expect(() =>
      checkWorkflow(Effect.runSync(decodeYaml(source, WorkflowInput))),
    ).toThrow(diagnostic);
    expect(() => checkWorkflow(workflowFixture(source))).toThrow(diagnostic);
  }
});

test('decoding the same mutable workflow does not reuse stale jobs', () => {
  const input = workflowFixture(WORKFLOW);
  expect(() =>
    checkWorkflow(Schema.decodeUnknownSync(WorkflowInput)(input)),
  ).not.toThrow();
  input.jobs.checks.steps[0]!.uses = 'actions/checkout@v4';
  expect(() =>
    checkWorkflow(Schema.decodeUnknownSync(WorkflowInput)(input)),
  ).toThrow('full commit SHA');
});

for (const [key, location, diagnostic] of [
  ['if', '    name: checks', 'stable name and run unconditionally'],
  [
    'continue-on-error',
    '    name: checks',
    'stable name and run unconditionally',
  ],
  ['if', '        run: bun run check:pr', 'unconditionally without overrides'],
  [
    'continue-on-error',
    '        run: bun run check:pr',
    'unconditionally without overrides',
  ],
  ['env', '        run: bun run check:pr', 'unconditionally without overrides'],
] as const) {
  test(`CI rejects ${key} presence at ${location.trim()}`, () => {
    for (const value of [
      'false',
      "'false'",
      'null',
      '0',
      "''",
      '{}',
      '{GITHUB_EVENT_NAME: push}',
      '.inf',
      '!!binary aGVsbG8=',
    ]) {
      const indent = location.slice(
        0,
        location.length - location.trimStart().length,
      );
      const source = WORKFLOW.replace(
        location,
        `${location}\n${indent}${key}: ${value}`,
      );
      expect(source).not.toBe(WORKFLOW);
      expect(() =>
        checkWorkflow(Effect.runSync(decodeYaml(source, WorkflowInput))),
      ).toThrow(diagnostic);
    }
  });
}

for (const [location, extra, diagnostic] of [
  ['  pull_request:', '  pull_request_target: .inf\n', 'privileged trigger'],
  ['    types:', '    paths: .inf\n', 'without branch or path filters'],
  [
    '  contents: read',
    '  extra: !!binary aGVsbG8=\n',
    'CI must use contents: read',
  ],
  [
    '          bun-version-file:',
    '          extra: !!timestamp 2026-01-01\n',
    'pinned in package.json',
  ],
] as const) {
  test(`CI retains extra keys beside ${location.trim()}`, () => {
    const source = WORKFLOW.replace(location, `${extra}${location}`);
    expect(source).not.toBe(WORKFLOW);
    expect(() =>
      checkWorkflow(Effect.runSync(decodeYaml(source, WorkflowInput))),
    ).toThrow(diagnostic);
  });
}

test('workflow decodes only consumed metadata, including action inputs', () => {
  const source = WORKFLOW.replace(
    'name: CI',
    'name: !!binary aGVsbG8=\nmetadata: &self {again: *self}',
  )
    .replace(
      '    name: checks',
      '    metadata: !!set {a: null}\n    name: checks',
    )
    .replace(
      '        uses: actions/checkout@',
      '        metadata: .inf\n        uses: actions/checkout@',
    )
    .replace(
      '          persist-credentials: false',
      '          ignored-input: !!timestamp 2026-01-01\n          persist-credentials: false',
    );
  expect(() =>
    checkWorkflow(Effect.runSync(decodeYaml(source, WorkflowInput))),
  ).not.toThrow();
});

test('invalid consumed fields retain policy diagnostic order', () => {
  const labels = Effect.runSync(
    decodeJson('[{"name":"","color":42,"description":false},null]', LabelInput),
  );
  expect(() => checkLabels(labels)).toThrow('invalid or duplicate label name');
  expect(() =>
    checkTemplate('---\nname: ""\nabout: []\nlabels: false\n---\n', new Set()),
  ).toThrow('missing template name');
  const source = WORKFLOW.replace(
    '    name: checks',
    '    name: wrong',
  ).replace('    timeout-minutes: 10', '    timeout-minutes: []');
  expect(() =>
    checkWorkflow(Effect.runSync(decodeYaml(source, WorkflowInput))),
  ).toThrow('stable name');
  const event = Effect.runSync(
    decodeEventJson('{"pull_request":{"draft":"true","body":42}}', PREvent),
  );
  expect(checkEvent(event)).toEqual(['pull_request.draft must be a boolean']);
  expect(checkBody(Schema.decodeUnknownSync(BodyInput)(42))).toEqual([
    'PR body must be text',
  ]);
});

test('package and label inputs ignore unrelated numeric overflow', () => {
  const packageSource = readFileSync(
    resolve(ROOT, 'package.json'),
    'utf8',
  ).replace('"private": true', '"private": true, "unused": 1e400');
  expect(() =>
    checkToolchain(Effect.runSync(decodeJson(packageSource, PackageInput))),
  ).not.toThrow();
  const labelSource = readFileSync(
    resolve(ROOT, '.github/labels.json'),
    'utf8',
  ).replace('"name":', '"unused": 1e400, "name":');
  expect(() =>
    checkLabels(Effect.runSync(decodeJson(labelSource, LabelInput))),
  ).not.toThrow();
});

test('tooling versions are validated before comparing the new plugin pair', () => {
  const source = readFileSync(resolve(ROOT, 'package.json'), 'utf8');
  for (const [left, right, diagnostic] of [
    ['1', '2', 'exact versions'],
    ['null', '2', 'exact versions'],
    ['{}', '{}', 'exact versions'],
    ['[]', '[]', 'exact versions'],
    ['false', 'true', 'exact versions'],
    ['"1.82.0"', '"1.81.0"', 'matching versions'],
    ['null', 'null', 'exact versions'],
    ['1', '1', 'exact versions'],
  ] as const) {
    const changed = source
      .replace('"oxlint": "1.82.0"', `"oxlint": ${left}`)
      .replace('"@oxlint/plugins": "1.82.0"', `"@oxlint/plugins": ${right}`);
    expect(changed).not.toBe(source);
    expect(() =>
      checkToolchain(Effect.runSync(decodeJson(changed, PackageInput))),
    ).toThrow(diagnostic);
  }
});

test('parsing failures use the typed Effect error channel', () => {
  for (const source of [
    'key: [unterminated',
    'key: 1\nkey: 2',
    'key: !unknown value',
  ]) {
    const result = Effect.runSync(
      Effect.result(decodeYaml(source, WorkflowInput)),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result))
      expect(result.failure).toBeInstanceOf(InputError);
  }
  const syntax = Effect.runSync(
    Effect.result(decodeEventJson('private-invalid', PREvent)),
  );
  expect(Result.isFailure(syntax)).toBe(true);
  if (Result.isFailure(syntax))
    expect(syntax.failure).toBeInstanceOf(SyntaxError);
  const duplicate = Effect.runSync(
    Effect.result(decodeJson('{"name":1,"na\\u006de":2}', LabelInput)),
  );
  expect(Result.isFailure(duplicate)).toBe(true);
  if (Result.isFailure(duplicate))
    expect(duplicate.failure.message).toContain('unique');
  const precedence = Effect.runSync(
    Effect.result(decodeJson('{"name":1,"name":2}', Schema.String)),
  );
  expect(Result.isFailure(precedence)).toBe(true);
  if (Result.isFailure(precedence))
    expect(precedence.failure.message).toContain('unique');
  const invalid = Effect.runSync(
    Effect.result(decodeJson('42', Schema.String)),
  );
  expect(Result.isFailure(invalid)).toBe(true);
  if (Result.isFailure(invalid))
    expect(invalid.failure).toBeInstanceOf(InputError);
});

for (const [source, diagnostic] of [
  ['null', 'workflow must be a mapping'],
  ['{}', 'CI must run on every pull request'],
  ['on: {pull_request: null}', 'expected a mapping'],
  ['on: {pull_request: {}, privileged: null}', 'privileged trigger'],
  [
    'on: {pull_request: {types: null, paths: []}}',
    'without branch or path filters',
  ],
] as const) {
  test(`workflow boundary preserves diagnostic for ${source}`, () => {
    expect(() =>
      checkWorkflow(Effect.runSync(decodeYaml(source, WorkflowInput))),
    ).toThrow(diagnostic);
  });
}
