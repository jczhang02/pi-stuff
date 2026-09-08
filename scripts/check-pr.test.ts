import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {checkBody, checkEvent} from './check-pr';
import {Schema} from 'effect';
import {BodyInput, PREvent} from './contracts';

const ROOT = resolve(import.meta.dir, '..');
const BODY = `### Behavior and impact
Before: contributor steps were unclear. After: the guide names the existing checks.
No runtime behavior changes.

### Approach and decisions
Keep commands in the contribution guide rather than duplicating them in each template.

### Verification and reproduction
Run \`bun run check:repo\` after installing the pinned dependencies.
Observed: repository checks passed. Expected: exit 0 and no missing local links.
Tests were added after implementation; no TDD claim.

### Risk and review
Risk level: low
Independent review: not-required
Review evidence: Documentation-only clarification; no interface or workflow gate changes.

### Related work
No task: this is a small documentation clarification.
`;
const EVIDENCE =
  'Review evidence: Documentation-only clarification; no interface or workflow gate changes.';
const DECLARATIONS = `Risk level: low\nIndependent review: not-required\n${EVIDENCE}`;
const RELATED_PREFIX = BODY.slice(0, BODY.indexOf('### Related work'));

describe('PR evidence', () => {
  test('complete body passes', () => expect(checkBody(BODY)).toEqual([]));
  test('bulleted bold declarations support bilingual list evidence', () => {
    const body = BODY.replace(
      DECLARATIONS,
      `- **Risk level:** low
- **Independent review:** not-required
- **Review evidence:**
  - Documentation-only clarification; no interface or workflow gate changes.

#### 中文
- **风险等级：**低。
- **独立审查：**不需要；仅修改文档，没有改变接口或工作流门禁。
`,
    );
    expect(checkBody(body)).toEqual([]);
  });
  test('plain and supported rich declaration labels can be mixed', () => {
    for (const prefix of ['', '- ', '* ', '+ ']) {
      for (const [open, close] of [
        ['', ':'],
        ['**', ':**'],
        ['**', '**:'],
      ] as const) {
        const declarations = `${prefix}${open}Risk level${close} low\n${prefix}${open}Independent review${close} not-required\n${prefix}${open}Review evidence${close}\n  - Documentation-only clarification; no gate changes.`;
        expect(checkBody(BODY.replace(DECLARATIONS, declarations))).toEqual([]);
      }
    }
    expect(
      checkBody(
        BODY.replace(
          EVIDENCE,
          '- **Review evidence**:\n  - Documentation-only clarification.',
        ),
      ),
    ).toEqual([]);
  });
  test('styled fields still enforce duplicates, exact values and review status', () => {
    for (const replacement of [
      '- **Risk level:** low\nRisk level: high',
      'Risk level: low\n+ **Risk level**: high',
      '- **Risk level:** high',
      '- **Risk level:** **low**',
      '- **Risk level:**',
      '- **Risk level: low',
      '| Risk level | low |',
      '> **Risk level:** low',
      '  - **Risk level:** low',
    ])
      expect(
        checkBody(BODY.replace('Risk level: low', replacement)),
      ).not.toEqual([]);
    expect(
      checkBody(
        BODY.replace(
          'Independent review: not-required',
          '- **Independent review:** pending',
        ),
      ),
    ).not.toEqual([]);
    expect(
      checkBody(
        BODY.replace(
          EVIDENCE,
          `${EVIDENCE}\n- **Review evidence:** Another report.`,
        ),
      ),
    ).not.toEqual([]);
  });
  test('formatted examples inside fences or comments cannot supply declarations', () => {
    const fields =
      '- **Risk level:** low\n- **Independent review:** not-required\n- **Review evidence:** Documentation-only clarification.';
    for (const hidden of [
      '```markdown\n' + fields + '\n```',
      '<!--\n' + fields + '\n-->',
    ]) {
      expect(checkBody(BODY.replace(DECLARATIONS, hidden))).not.toEqual([]);
    }
  });
  test('formatted multiline evidence can precede other declarations', () => {
    expect(
      checkBody(
        BODY.replace(
          DECLARATIONS,
          '- **Review evidence:**\n  - Documentation-only clarification.\n- **Risk level:** low\n- **Independent review:** not-required',
        ),
      ),
    ).toEqual([]);
    expect(
      checkBody(
        BODY.replace(
          DECLARATIONS,
          '- **Review evidence:**\n  - **TODO**\n- **Risk level:** low\n- **Independent review:** not-required',
        ),
      ),
    ).not.toEqual([]);
  });
  test('template alone fails', () =>
    expect(
      checkBody(
        readFileSync(resolve(ROOT, '.github/pull_request_template.md'), 'utf8'),
      ),
    ).not.toEqual([]));
  test('empty or nontext body fails', () => {
    for (const body of ['', null, {}, 42])
      expect(checkBody(Schema.decodeUnknownSync(BodyInput)(body))).not.toEqual(
        [],
      );
  });
  test('missing section fails', () =>
    expect(
      checkBody(BODY.replace('### Approach and decisions', '### Other notes')),
    ).not.toEqual([]));
  test('duplicate section fails', () =>
    expect(checkBody(`${BODY}\n### Related work\nAnother task.\n`)).toContain(
      'duplicate PR section',
    ));
  test('comments do not supply evidence', () =>
    expect(checkBody(`<!--\n${BODY}\n-->`)).not.toEqual([]));
  test('fenced headings do not supply sections', () =>
    expect(checkBody('```markdown\n' + BODY + '\n```')).not.toEqual([]));
  test('nested fences do not supply sections', () =>
    expect(
      checkBody('````markdown\n```text\n' + BODY + '\n```\n````'),
    ).not.toEqual([]));
  test('bare placeholders fail', () => {
    for (const placeholder of [
      'N/A',
      'TODO',
      'TBD',
      '- [ ]',
      '```text\n```',
      'GitHub issue:\nBeads ID:',
      'not applİcable',
      'not applıcable',
    ]) {
      expect(
        checkBody(`${RELATED_PREFIX}### Related work\n${placeholder}`),
      ).not.toEqual([]);
    }
  });
  test('formatting and translated empty labels do not supply evidence', () => {
    for (const placeholder of [
      '**TODO**',
      '__N/A__',
      '`TBD`',
      '***TODO***',
      '**审查依据：**',
      '**GitHub issue:**',
    ]) {
      expect(
        checkBody(BODY.replace(EVIDENCE, `Review evidence:\n- ${placeholder}`)),
      ).not.toEqual([]);
      expect(
        checkBody(`${RELATED_PREFIX}### Related work\n- ${placeholder}`),
      ).not.toEqual([]);
    }
  });
  test('plus-list placeholders cannot become evidence', () => {
    expect(
      checkBody(BODY.replace(EVIDENCE, '- **Review evidence:**\n  + **TODO**')),
    ).not.toEqual([]);
    expect(
      checkBody(`${RELATED_PREFIX}### Related work\n+ **TODO**`),
    ).not.toEqual([]);
  });
  test('explained limitation passes', () =>
    expect(
      checkBody(
        BODY.replace(
          'No task: this is a small documentation clarification.',
          'N/A: explicitly authorized bootstrap work, with no prior task.',
        ),
      ),
    ).toEqual([]));
  test('high risk needs independent review', () =>
    expect(
      checkBody(BODY.replace('Risk level: low', 'Risk level: high')),
    ).not.toEqual([]));
  test('completed high-risk review passes', () => {
    const body = BODY.replace('Risk level: low', 'Risk level: high')
      .replace(
        'Independent review: not-required',
        'Independent review: completed',
      )
      .replace(
        EVIDENCE,
        'Review evidence: Separate reviewer inspected base abc123 to head def456; one blocking issue fixed and follow-up reviewed. See linked review report.',
      );
    expect(checkBody(body)).toEqual([]);
  });
  test('multiline review evidence passes', () =>
    expect(
      checkBody(
        BODY.replace(
          EVIDENCE,
          'Review evidence:\nDocumentation-only clarification.\nNo interface or workflow gate changes.',
        ),
      ),
    ).toEqual([]));
  test('multiline evidence can precede other declarations', () =>
    expect(
      checkBody(
        BODY.replace(
          DECLARATIONS,
          'Review evidence:\nDocumentation-only clarification.\nRisk level: low\nIndependent review: not-required',
        ),
      ),
    ).toEqual([]));
  test('higher-level heading ends section', () => {
    for (const heading of ['# Appendix', '## Appendix'])
      expect(
        checkBody(
          `${RELATED_PREFIX}### Related work\n\n${heading}\nUnrelated text.\n`,
        ),
      ).not.toEqual([]);
  });
  test('subheading alone is not evidence', () => {
    expect(
      checkBody(`${RELATED_PREFIX}### Related work\n\n#### Task links\n`),
    ).not.toEqual([]);
    expect(
      checkBody(
        `${RELATED_PREFIX}### Related work\n\n#### Task links\nRefs #2.\n`,
      ),
    ).toEqual([]);
  });
  test('declared waiver passes but authorization is not proven', () => {
    const body = BODY.replace('Risk level: low', 'Risk level: high')
      .replace('Independent review: not-required', 'Independent review: waived')
      .replace(
        EVIDENCE,
        'Review evidence: Maintainer explicitly waived review in the linked task comment; this validator cannot authenticate that claim.',
      );
    expect(checkBody(body)).toEqual([]);
  });
  test('pending review fails when ready', () =>
    expect(
      checkBody(
        BODY.replace(
          'Independent review: not-required',
          'Independent review: pending',
        ),
      ),
    ).not.toEqual([]));
  test('unknown risk fails', () =>
    expect(
      checkBody(BODY.replace('Risk level: low', 'Risk level: maybe')),
    ).not.toEqual([]));
  test('empty review field does not consume next line', () =>
    expect(
      checkBody(BODY.replace('Risk level: low', 'Risk level:')),
    ).not.toEqual([]));
  test('duplicate review field fails', () =>
    expect(
      checkBody(
        BODY.replace('Risk level: low', 'Risk level: low\nRisk level: high'),
      ),
    ).not.toEqual([]));
  test('review fields inside fences do not count', () => {
    const start = BODY.indexOf('Risk level:');
    const end = BODY.indexOf('### Related work');
    expect(
      checkBody(
        BODY.slice(0, start) +
          '```text\n' +
          BODY.slice(start, end) +
          '```\n' +
          BODY.slice(end),
      ),
    ).not.toEqual([]);
  });
  test('draft can be incomplete', () =>
    expect(checkEvent({pull_request: {draft: true, body: null}})).toEqual([]));
  test('ready event checks body', () => {
    expect(checkEvent({pull_request: {draft: false, body: BODY}})).toEqual([]);
    expect(checkEvent({pull_request: {draft: false, body: null}})).not.toEqual(
      [],
    );
  });
  test('malformed events fail', () => {
    for (const event of [
      [],
      {},
      {pull_request: []},
      {pull_request: {draft: 'false', body: BODY}},
    ])
      expect(checkEvent(Schema.decodeUnknownSync(PREvent)(event))).not.toEqual(
        [],
      );
  });
  test('Unicode line separators cannot expose fenced evidence', () => {
    for (const separator of ['\u2028', '\u2029']) {
      expect(
        checkBody('```markdown' + separator + 'x\n' + BODY + '\n```'),
      ).not.toEqual([]);
    }
  });
  test('legacy whitespace cannot expose fenced evidence', () => {
    expect(checkBody('\u001f```markdown\n' + BODY + '\n```')).not.toEqual([]);
    expect(checkBody('```markdown\nexample\n```\ufeff\n' + BODY)).not.toEqual(
      [],
    );
    expect(checkBody('```markdown\nexample\n```\u001f\n' + BODY)).toEqual([]);
    expect(
      checkBody(BODY.replace('Risk level: low', 'Risk level: low\ufeff')),
    ).not.toEqual([]);
  });
  test('legacy line boundaries preserve PR structure', () => {
    for (const separator of [
      '\r\n',
      '\r',
      '\v',
      '\f',
      '\x1c',
      '\x1d',
      '\x1e',
      '\u0085',
      '\u2028',
      '\u2029',
    ]) {
      expect(checkBody(BODY.replaceAll('\n', separator))).toEqual([]);
    }
  });
  test('CRLF evidence and Unicode text retain their meaning', () => {
    expect(checkBody(BODY.replaceAll('\n', '\r\n'))).toEqual([]);
    expect(
      checkBody(`${RELATED_PREFIX}### Related work\n相关任务已完成。\n`),
    ).toEqual([]);
  });
});

describe('PR checker CLI', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(resolve(tmpdir(), 'pi-check-pr-'));
  });
  afterEach(() => rmSync(directory, {recursive: true, force: true}));
  function cli(
    args: string[] = [],
    env: Record<string, string | undefined> = {},
  ) {
    const result = Bun.spawnSync(
      [process.execPath, resolve(ROOT, 'scripts/check-pr.ts'), ...args],
      {
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: '',
          GITHUB_EVENT_PATH: '',
          ...env,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    return {
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }
  function eventCli(event: typeof PREvent.Type, name = 'pull_request') {
    const path = resolve(directory, 'event.json');
    writeFileSync(path, JSON.stringify(event));
    return cli([], {GITHUB_EVENT_PATH: path, GITHUB_EVENT_NAME: name});
  }
  test('reads event and reports failure', () => {
    const good = eventCli({pull_request: {draft: false, body: BODY}});
    const bad = eventCli({pull_request: {draft: false, body: ''}});
    expect(good.code).toBe(0);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('missing or empty section');
  });
  test('never executes body', () => {
    const marker = resolve(directory, 'must-not-exist');
    const body =
      BODY +
      `\n$(touch ${marker})\n\`touch ${marker}\`\n` +
      '${{ secrets.GITHUB_TOKEN }}\n';
    const result = eventCli({pull_request: {draft: false, body}});
    expect(result.code).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(result.stdout + result.stderr).not.toContain('GITHUB_TOKEN');
  });
  test('skips non-PR events', () => {
    const result = eventCli({}, 'push');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('not applicable');
  });
  test('accepts body file', () => {
    const path = resolve(directory, 'body.md');
    writeFileSync(path, BODY);
    expect(cli(['--body-file', path]).code).toBe(0);
  });
  test('accepts rich bilingual evidence through both CLI input modes', () => {
    const body = BODY.replace(
      DECLARATIONS,
      `- **Risk level:** high
- **Independent review:** completed
- **Review evidence:**
  - Fixture reviewer checked the full diff in a separate context; no unresolved findings.

#### 中文
- **风险等级：**高。
- **独立审查：**已完成。
- **审查依据：**测试夹具中的审查者在独立上下文检查了完整差异，没有未解决的发现。
`,
    );
    const path = resolve(directory, 'bilingual.md');
    writeFileSync(path, body);
    expect(cli(['--body-file', path]).code).toBe(0);
    expect(eventCli({pull_request: {draft: false, body}}).code).toBe(0);
  });
  test('missing event path fails without disclosing input', () => {
    const result = cli([], {GITHUB_EVENT_NAME: 'pull_request'});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Cannot read PR evidence input');
  });
  test('malformed JSON fails without echoing the payload', () => {
    const path = resolve(directory, 'event.json');
    writeFileSync(path, 'sensitive-payload-not-json');
    const result = cli([], {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: path,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain('sensitive-payload');
  });
  test('invalid UTF-8 fails rather than replacing bytes', () => {
    const path = resolve(directory, 'body.md');
    writeFileSync(
      path,
      Buffer.concat([Buffer.from(BODY), Buffer.from([0xff])]),
    );
    expect(cli(['--body-file', path]).code).toBe(1);
  });
  test('help succeeds', () => expect(cli(['--help']).code).toBe(0));
  test('unknown or incomplete options fail', () => {
    expect(cli(['--unknown']).code).toBe(2);
    expect(cli(['--body-file']).code).toBe(2);
  });
});
