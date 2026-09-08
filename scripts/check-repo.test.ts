import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {
  checkLabels,
  checkMarkdown,
  checkPath,
  checkRepo,
  checkTemplate,
  checkText,
  checkToolchain,
  checkWorkflow,
  loadJson,
  loadYaml,
} from './check-repo';

import {Effect, Schema} from 'effect';
import {decodeJson, decodeYaml} from './parse';
import {Package} from './contracts';
import {labelsFixture, workflowFixture} from './fixtures';

const ROOT = resolve(import.meta.dir, '..');

describe('repository checks', () => {
  let labels: ReturnType<typeof labelsFixture>;
  let names: Set<string>;
  let workflow: ReturnType<typeof workflowFixture>;
  let directory: string;
  beforeEach(() => {
    labels = labelsFixture(
      readFileSync(resolve(ROOT, '.github/labels.json'), 'utf8'),
    );
    names = checkLabels(labels);
    workflow = workflowFixture(
      readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8'),
    );
    directory = mkdtempSync(resolve(tmpdir(), 'pi-check-repo-'));
  });
  afterEach(() => rmSync(directory, {recursive: true, force: true}));

  test('current workflow', () =>
    expect(() => checkWorkflow(workflow)).not.toThrow());
  test('YAML keeps on key and boolean values', () =>
    expect(
      Effect.runSync(
        decodeYaml(
          'on: push\nenabled: true\ndisabled: false\n',
          Schema.Struct({
            on: Schema.String,
            enabled: Schema.Boolean,
            disabled: Schema.Boolean,
          }),
        ),
      ),
    ).toEqual({
      on: 'push',
      enabled: true,
      disabled: false,
    }));
  test('duplicate YAML keys fail', () =>
    expect(() => loadYaml('name: first\nname: second\n')).toThrow(/unique/));
  test('duplicate JSON keys fail', () =>
    expect(() => loadJson('{"name": 1, "name": 2}')).toThrow(/unique/));
  test('text formatting', () => {
    expect(checkText('Plain text.\n')).toEqual([]);
    for (const text of [
      'no newline',
      'trailing \n',
      'tabs\there\n',
      'windows\r\n',
    ])
      expect(checkText(text)).not.toEqual([]);
  });
  test('duplicate labels fail', () => {
    labels.push(structuredClone(labels[0]!));
    expect(() => checkLabels(labels)).toThrow(/duplicate label/);
  });
  test('invalid label color fails', () => {
    labels[0]!.color = 'red';
    expect(() => checkLabels(labels)).toThrow(/invalid color/);
  });
  test('missing canonical label fails', () =>
    expect(() => checkLabels([])).toThrow(/missing canonical/));
  test('templates', () => {
    for (const file of readdirSync(
      resolve(ROOT, '.github/ISSUE_TEMPLATE'),
    ).filter(file => file.endsWith('.md'))) {
      expect(() =>
        checkTemplate(
          readFileSync(resolve(ROOT, '.github/ISSUE_TEMPLATE', file), 'utf8'),
          names,
        ),
      ).not.toThrow();
    }
  });
  test('template unknown label fails', () =>
    expect(() =>
      checkTemplate(
        '---\nname: Bug\nabout: Report\nlabels: [needs-triage, unknown]\n---\n',
        names,
      ),
    ).toThrow(/known labels/));
  test('template missing triage fails', () =>
    expect(() =>
      checkTemplate(
        '---\nname: Bug\nabout: Report\nlabels: [bug]\n---\n',
        names,
      ),
    ).toThrow(/needs-triage/));
  test('template missing frontmatter fails', () =>
    expect(() => checkTemplate('# Bug\n', names)).toThrow(/frontmatter/));
  test('tracked local files fail', () => {
    for (const path of [
      '.beads/metadata.json',
      '.worktrees/topic/file.md',
      'scripts/__pycache__/file.pyc',
      '.env',
      'a/.env.local',
      'node_modules/x.js',
    ])
      expect(checkPath(path)).not.toEqual([]);
    expect(checkPath('.env.example')).toEqual([]);
  });
  test('Markdown file links', () => {
    writeFileSync(resolve(directory, 'target file.md'), '# Target\n');
    expect(
      checkMarkdown(
        directory,
        resolve(directory, 'README.md'),
        '[target](target%20file.md#section)\n[web](https://example.com)\n',
      ),
    ).toEqual([]);
    expect(
      checkMarkdown(
        directory,
        resolve(directory, 'README.md'),
        '[missing](missing.md)\n',
      ).some(error => error.includes('missing local')),
    ).toBe(true);
  });
  test('HTML and reference links', () => {
    for (const text of ['<img src="missing.png">\n', '[guide]: missing.md\n'])
      expect(
        checkMarkdown(directory, resolve(directory, 'README.md'), text),
      ).not.toEqual([]);
  });
  test('Markdown links cannot escape repo', () =>
    expect(
      checkMarkdown(
        directory,
        resolve(directory, 'README.md'),
        '[escape](../outside)\n',
      ).some(error => error.includes('escapes')),
    ).toBe(true));
  test('fenced examples are not links', () =>
    expect(
      checkMarkdown(
        ROOT,
        resolve(ROOT, 'README.md'),
        '```markdown\n[example](not-a-real-file)\n```\n',
      ),
    ).toEqual([]));
  test('unclosed and nested fences', () => {
    expect(
      checkMarkdown(
        ROOT,
        resolve(ROOT, 'README.md'),
        '```typescript\nvoid 0;\n',
      ),
    ).not.toEqual([]);
    expect(
      checkMarkdown(
        ROOT,
        resolve(ROOT, 'README.md'),
        '````markdown\n```typescript\nvoid 0;\n```\n````\n',
      ),
    ).toEqual([]);
  });
  test('Unicode line separators retain Markdown fence boundaries', () => {
    for (const separator of ['\u2028', '\u2029']) {
      const text =
        '```markdown' + separator + 'x\n[example](not-a-real-file)\n```\n';
      expect(checkMarkdown(ROOT, resolve(ROOT, 'README.md'), text)).toEqual([]);
    }
  });
  test('legacy whitespace retains Markdown fence boundaries', () => {
    const link = '[example](not-a-real-file)\n';
    expect(
      checkMarkdown(
        ROOT,
        resolve(ROOT, 'README.md'),
        '\u001f```markdown\n' + link + '```\n',
      ),
    ).toEqual([]);
    expect(
      checkMarkdown(
        ROOT,
        resolve(ROOT, 'README.md'),
        '```markdown\n```\ufeff\n' + link + '```\n',
      ),
    ).toEqual([]);
  });
  test('label description length counts Unicode characters', () => {
    labels[0]!.description = '😀'.repeat(100);
    expect(() => checkLabels(labels)).not.toThrow();
    labels[0]!.description += 'x';
    expect(() => checkLabels(labels)).toThrow(/invalid description/);
  });
  test('heading spacing', () =>
    expect(
      checkMarkdown(ROOT, resolve(ROOT, 'README.md'), '##Bad heading\n'),
    ).not.toEqual([]));
  test('PR filters fail', () => {
    workflow.on.pull_request = {paths: ['scripts/**']};
    expect(() => checkWorkflow(workflow)).toThrow(/filters/);
  });
  test('body edits must trigger CI', () => {
    workflow.on.pull_request.types = workflow.on.pull_request.types!.filter(
      event => event !== 'edited',
    );
    expect(() => checkWorkflow(workflow)).toThrow(/PR CI must run/);
  });
  test('commit check is required and cannot be overridden', () => {
    for (const override of ['remove', 'if', 'continue-on-error', 'env']) {
      const changed = structuredClone(workflow);
      const step = changed.jobs.checks.steps.find(
        item => item.run === 'bun run check:commit',
      );
      if (override === 'remove') {
        changed.jobs.checks.steps = changed.jobs.checks.steps.filter(
          item => item.run !== 'bun run check:commit',
        );
      } else if (step) {
        if (override === 'if') step.if = true;
        if (override === 'continue-on-error') step['continue-on-error'] = true;
        if (override === 'env') step.env = true;
      }
      expect(() => checkWorkflow(changed)).toThrow(/bun run check:commit/);
    }
  });
  test('checkout needs full history', () => {
    workflow.jobs.checks.steps[0]!.with!['fetch-depth'] = '1';
    expect(() => checkWorkflow(workflow)).toThrow(/full history/);
  });
  test('evidence step cannot be skipped', () => {
    workflow.jobs.checks.steps.at(-1)!.if = true;
    expect(() => checkWorkflow(workflow)).toThrow(/unconditionally/);
  });
  test('evidence step is required', () => {
    workflow.jobs.checks.steps.pop();
    expect(() => checkWorkflow(workflow)).toThrow(/bun run check:pr/);
  });
  test('privileged trigger fails', () => {
    expect(() =>
      checkWorkflow({
        ...workflow,
        on: {...workflow.on, pull_request_target: null},
      }),
    ).toThrow(/privileged trigger/);
  });
  test('write permissions fail', () => {
    workflow.permissions.contents = 'write';
    expect(() => checkWorkflow(workflow)).toThrow(/contents: read/);
  });
  test('mutable Action ref fails', () => {
    workflow.jobs.checks.steps[0]!.uses = 'actions/checkout@v4';
    expect(() => checkWorkflow(workflow)).toThrow(/full commit SHA/);
  });
  test('checkout credentials fail', () => {
    workflow.jobs.checks.steps[0]!.with!['persist-credentials'] = true;
    expect(() => checkWorkflow(workflow)).toThrow(/persist credentials/);
  });
  test('required job cannot be conditional', () => {
    workflow.jobs.checks.if = true;
    expect(() => checkWorkflow(workflow)).toThrow(/unconditionally/);
  });
  test('self-hosted runner fails', () => {
    workflow.jobs.checks['runs-on'] = 'self-hosted';
    expect(() => checkWorkflow(workflow)).toThrow(/GitHub-hosted/);
  });
  test('job needs timeout', () => {
    delete workflow.jobs.checks['timeout-minutes'];
    expect(() => checkWorkflow(workflow)).toThrow(/timeout/);
  });
  test('checker collects file errors', () => {
    mkdirSync(resolve(directory, '.github'));
    writeFileSync(
      resolve(directory, '.github/labels.json'),
      JSON.stringify(labels),
    );
    writeFileSync(resolve(directory, 'broken.md'), '[broken](missing.md) \n');
    const errors = checkRepo(directory, ['broken.md']);
    expect(errors.some(error => error.includes('trailing whitespace'))).toBe(
      true,
    );
    expect(errors.some(error => error.includes('missing local'))).toBe(true);
  });

  test('nested and escaped duplicate JSON keys fail', () => {
    for (const text of [
      '{"nested":{"name":1,"name":2}}',
      '{"name":1,"na\\u006de":2}',
    ])
      expect(() => loadJson(text)).toThrow(/unique/);
  });
  test('YAML syntax is not accepted as JSON', () => {
    for (const text of [
      'name: value',
      '{"name":1,}',
      '// comment\n{}',
      '{unquoted:1}',
    ])
      expect(() => loadJson(text)).toThrow();
  });
  test('YAML rejects nested duplicates and invalid syntax', () => {
    expect(() => loadYaml('parent:\n  name: first\n  name: second\n')).toThrow(
      /unique/,
    );
    expect(() => loadYaml('name: [unterminated\n')).toThrow();
  });
  test('unknown YAML tags fail rather than falling back to strings', () => {
    expect(() => loadYaml('key: !unknown value\n')).toThrow(/Unresolved tag/);
    expect(() => loadYaml('key: !!python/name:os.system\n')).toThrow(
      /Unresolved tag/,
    );
  });
  test('symlink links cannot escape repo', () => {
    symlinkSync(tmpdir(), resolve(directory, 'outside'));
    expect(
      checkMarkdown(
        directory,
        resolve(directory, 'README.md'),
        '[escape](outside)\n',
      ).some(error => error.includes('escapes')),
    ).toBe(true);
  });
  test('invalid URL encoding reports a file error', () =>
    expect(
      checkMarkdown(
        directory,
        resolve(directory, 'README.md'),
        '[bad](invalid%xy)\n',
      ),
    ).not.toEqual([]));
  test('CI needs locked installation without lifecycle scripts', () => {
    workflow.jobs.checks.steps.find(step =>
      step.run?.startsWith('bun install'),
    )!.run = 'bun install';
    expect(() => checkWorkflow(workflow)).toThrow(/frozen-lockfile/);
  });
  test('type checking and tests cannot be omitted', () => {
    for (const command of ['bun run typecheck', 'bun run test']) {
      const changed = structuredClone(workflow);
      changed.jobs.checks.steps = changed.jobs.checks.steps.filter(
        step => step.run !== command,
      );
      expect(() => checkWorkflow(changed)).toThrow(command);
    }
  });
  test('required job cannot ignore errors', () => {
    workflow.jobs.checks['continue-on-error'] = true;
    expect(() => checkWorkflow(workflow)).toThrow(/unconditionally/);
  });
  test('CI cannot override evidence environment at the step', () => {
    workflow.jobs.checks.steps.at(-1)!.env = true;
    expect(() => checkWorkflow(workflow)).toThrow(/without overrides/);
  });
  test('CI takes Bun version from package.json', () => {
    workflow.jobs.checks.steps.find(step =>
      step.uses?.startsWith('oven-sh/setup-bun@'),
    )!.with = {'bun-version': 'latest'};
    expect(() => checkWorkflow(workflow)).toThrow(/pinned in package.json/);
  });
  test('toolchain versions are pinned', () => {
    const base = Effect.runSync(
      decodeJson(readFileSync(resolve(ROOT, 'package.json'), 'utf8'), Package),
    );
    expect(() => checkToolchain(base)).not.toThrow();
    expect(() =>
      checkToolchain({...base, packageManager: 'bun@latest'}),
    ).toThrow(/exact Bun/);
    expect(() => checkToolchain({...base, engines: {bun: '1.3.0'}})).toThrow(
      /must match/,
    );
    expect(() =>
      checkToolchain({
        ...base,
        devDependencies: Schema.decodeUnknownSync(
          Package.fields.devDependencies,
        )({typescript: '^7.0.2'}),
      }),
    ).toThrow(/exact versions/);
    expect(() =>
      checkToolchain({
        ...base,
        scripts: {...base.scripts, 'check:pr': 'echo passed'},
      }),
    ).toThrow(/script check:pr must run/);
  });
});
