import {expect, test} from 'bun:test';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {Effect} from 'effect';
import config from '../oxlint.config';
import {checkWorkflow} from './check-repo';
import {WorkflowInput} from './contracts';
import {decodeYaml} from './parse';

const ROOT = resolve(import.meta.dir, '..');
const PROBES = [
  [
    'no-chained-type-assertions',
    'export const value = {} as object as string;',
  ],
  [
    'no-conditional-empty-object-spread',
    'export function options(flag: boolean) { return {...(flag ? {flag} : {})}; }',
  ],
  [
    'no-known-value-widening',
    'export const handlers: Record<string, () => void> = {start: () => {}};',
  ],
  ['no-module-mocking', 'import {vi} from "vitest"; vi.mock("./module");'],
  [
    'no-object-parameters',
    'export function accept(value: object) { return value; }',
  ],
  [
    'no-reflect-apply',
    'export const result = Reflect.apply(Math.max, null, [1, 2]);',
  ],
  ['no-reflect-get', 'export const result = Reflect.get({value: 1}, "value");'],
  [
    'no-runtime-typeof',
    'export function narrow(value: string | number) { return typeof value === "string"; }',
  ],
  ['no-shape-in-symbol-names', 'export const userShape = {id: 1};'],
  [
    'no-unknown-parameters',
    'export function accept(value: unknown) { return value; }',
  ],
  ['no-unknown-returns', 'export function load(): unknown { return 1; }'],
  ['no-unknown-type-aliases', 'export type Payload = unknown;'],
  [
    'no-unsafe-dictionary-type',
    'export type Metadata = Record<string, unknown>;',
  ],
  [
    'no-widen-then-assert',
    'export function load() { const original = {id: 1}; const erased: unknown = original; return erased as {id: number}; }',
  ],
  [
    'require-safety-comment-for-type-assertion',
    'export const value = "id" as string;',
  ],
  [
    'no-service-constructor-imports',
    'import {makeClock} from "./clock"; export const clock = makeClock();',
  ],
] as const;

function lint(path: string) {
  const result = Bun.spawnSync(
    [
      process.execPath,
      '--bun',
      'oxlint',
      '--deny-warnings',
      '--disable-nested-config',
      '--config',
      resolve(ROOT, 'oxlint.config.ts'),
      '--no-ignore',
      path,
    ],
    {cwd: ROOT, stdout: 'pipe', stderr: 'pipe'},
  );
  return {
    code: result.exitCode,
    output: result.stdout.toString() + result.stderr.toString(),
  };
}

test('all anti-slop rules reject representative violations', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'pi-lint-probes-'));
  try {
    for (const [rule, source] of PROBES)
      writeFileSync(resolve(directory, `${rule}.ts`), source);
    const result = lint(directory);
    expect(result.code).toBe(1);
    for (const [rule] of PROBES) expect(result.output).toContain(`(${rule})`);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('lint accepts ordinary typed code', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'pi-lint-valid-'));
  try {
    const path = resolve(directory, 'valid.ts');
    writeFileSync(
      path,
      'export const double = (value: number) => value * 2;\n',
    );
    expect(lint(path).code).toBe(0);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('mandatory anti-slop rules remain errors', () => {
  for (const [rule] of PROBES) {
    const severity =
      rule === 'no-service-constructor-imports'
        ? config.rules['anti-slop-effect/no-service-constructor-imports']
        : config.rules[`anti-slop/${rule}`];
    expect(severity).toBe('error');
  }
});

test('format and lint stages cannot be removed from CI', () => {
  const source = readFileSync(
    resolve(ROOT, '.github/workflows/ci.yml'),
    'utf8',
  );
  for (const command of ['bun run format:check', 'bun run lint']) {
    expect(() =>
      checkWorkflow(
        Effect.runSync(
          decodeYaml(source.replace(command, 'echo skipped'), WorkflowInput),
        ),
      ),
    ).toThrow(command);
  }
});
