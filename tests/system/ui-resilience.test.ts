import {expect, test} from 'bun:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Native optional nulls keep dedicated headings and unchanged execution', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false},"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  try {
    await host.terminal.resize({cols: 120, rows: 60});
    await writeFile(join(host.directory, 'source.txt'), 'NULL_RANGE_BODY');
    await host.sequence([
      {
        name: 'bash',
        parameters: '{"command":"printf NULL_BASH_BODY","timeout":null}',
      },
      {
        name: 'grep',
        parameters: '{"pattern":"NULL_RANGE_BODY","path":null,"limit":null}',
      },
      {
        name: 'find',
        parameters: '{"pattern":"source.txt","path":null,"limit":null}',
      },
      {name: 'ls', parameters: '{"path":null,"limit":null}'},
    ]);
    const compact = await host.terminal.screen.text();
    for (const heading of [
      'Bash(printf NULL_BASH_BODY)',
      'Grep(NULL_RANGE_BODY, .)',
      'Find(source.txt, .)',
      'Ls(.)',
    ])
      expect(compact).toContain(`• ${heading}`);
    expect(compact).toContain('⎿  NULL_BASH_BODY');
    expect(compact).not.toContain('Completed');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('source.txt:1: NULL_RANGE_BODY', {
      timeoutMs: 5000,
    });
    await host.reload();
    const restored = await host.terminal.screen.text();
    expect(restored).toContain('⎿  NULL_BASH_BODY');
    expect(restored).toContain('source.txt:1: NULL_RANGE_BODY');
  } finally {
    await host.close();
  }
}, 30000);

test('WebRead optional nulls retain paging presentation', async () => {
  const host = await launchPi(
    '{"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      new Response('WEB_NULL_BODY', {headers: {'content-type': 'text/plain'}}),
  });
  try {
    const fetched = await host.invoke(
      'fetch_content',
      JSON.stringify({urls: [String(server.url)], mode: 'raw'}),
    );
    const contentId = /contentId: ([^\n]+)/u.exec(fetched)?.[1];
    expect(contentId).toBeDefined();
    const result = await host.invoke(
      'get_search_content',
      JSON.stringify({contentId, find: null, offset: null, limit: null}),
    );
    expect(result).toContain('WEB_NULL_BODY');
    expect(await host.terminal.screen.text()).toContain(
      '• WebRead(retained content)',
    );
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText(`WebRead(${contentId}, offset 0)`, {
      timeoutMs: 5000,
    });
    expect(await host.terminal.screen.text()).toContain('⎿  WEB_NULL_BODY');
  } finally {
    await server.stop(true);
    await host.close();
  }
}, 30000);

test('Unexpected details and coerced arguments retain our UI and actual results', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false}}',
    resolve('tests/system/fixtures/ui-unexpected-details.ts'),
    'ui',
  );
  try {
    await host.terminal.resize({cols: 120, rows: 60});
    await writeFile(join(host.directory, 'source.txt'), 'BEFORE');
    await host.sequence([
      {
        name: 'read',
        parameters: '{"path":"source.txt","offset":"1","limit":"1"}',
      },
      {name: 'bash', parameters: '{"command":"printf UNRECOGNIZED_DETAILS"}'},
      {name: 'write', parameters: '{"path":"written.txt","content":42}'},
      {
        name: 'edit',
        parameters:
          '{"path":"source.txt","edits":[{"oldText":"BEFORE","newText":"AFTER"}]}',
      },
    ]);
    for (const stage of ['live', 'reload']) {
      if (stage === 'reload') await host.reload();
      const screen = await host.terminal.screen.text();
      for (const label of ['Read', 'Bash', 'Write', 'Edit'])
        expect(screen).toContain(`• ${label}(`);
      expect(screen).toContain('⎿  BEFORE');
      expect(screen).toContain('⎿  UNRECOGNIZED_DETAILS');
      expect(screen).toContain('Successfully wrote');
      expect(screen).toContain('Successfully replaced');
      expect(screen).not.toContain('Wrote 0 lines');
      expect(screen).not.toContain('Read 1 file');
    }
    expect(await readFile(join(host.directory, 'written.txt'), 'utf8')).toBe(
      '42',
    );
    expect(await readFile(join(host.directory, 'source.txt'), 'utf8')).toBe(
      'AFTER',
    );
  } finally {
    await host.close();
  }
}, 30000);

test('Coerced retrieval arguments stay visible between adjacent groups', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await host.terminal.resize({cols: 120, rows: 50});
    await writeFile(join(host.directory, 'source.txt'), '42');
    const read = {name: 'read', parameters: '{"path":"source.txt"}'};
    await host.sequence([
      read,
      {name: 'grep', parameters: '{"pattern":42,"path":"source.txt"}'},
      read,
    ]);
    for (const stage of ['live', 'reload']) {
      if (stage === 'reload') await host.reload();
      const screen = await host.terminal.screen.text();
      expect(screen.match(/Read 1 file/gu)).toHaveLength(2);
      expect(screen).toContain('• Grep({"pattern":42,"path":"source.txt"})');
      expect(screen).toContain('⎿  source.txt:1: 42');
      expect(screen).not.toContain('Searched 1 pattern');
    }
  } finally {
    await host.close();
  }
}, 30000);

test('Malformed Edit patches retain successful results through disclosure and reload', async () => {
  const host = await launchPi(
    '{}',
    resolve('tests/system/fixtures/ui-invalid-patch.ts'),
    'ui',
  );
  try {
    for (const patch of [
      'not a unified patch',
      '@@ -1 +1 @@\n',
      '@@ -1 +1 @@\n-before\n',
      '@@ -1 +1 @@\n-before\n+after\nUNKNOWN',
      '@@ -1 +1 @@\n-before\n+after\n@@ -5 +5 @@\n-truncated',
    ]) {
      await host.command('/new');
      await host.terminal.screen.waitUntil(
        async () => !(await host.terminal.screen.text()).includes('Edit('),
        {timeoutMs: 5000},
      );
      await writeFile(join(host.directory, 'display.patch'), patch);
      await writeFile(join(host.directory, 'source.txt'), 'before');
      const result = await host.invoke(
        'edit',
        JSON.stringify({
          path: 'source.txt',
          edits: [{oldText: 'before', newText: 'after'}],
        }),
      );
      expect(result).toContain('Successfully replaced');
      expect(await readFile(join(host.directory, 'source.txt'), 'utf8')).toBe(
        'after',
      );
      for (const stage of ['compact', 'expanded', 'reload']) {
        if (stage === 'expanded')
          await host.terminal.keyboard.press('Control+O');
        if (stage === 'reload') await host.reload();
        const screen = await host.terminal.screen.text();
        expect(screen).toContain('• Edit(source.txt)');
        expect(screen).toContain(`⎿  ${result}`);
        expect(screen).not.toContain('Added ');
      }
    }
  } finally {
    await host.close();
  }
}, 60000);

test('Native Edit retains separated hunks, missing final newlines and empty-file changes', async () => {
  const host = await launchPi('{}', undefined, 'ui');
  try {
    await host.terminal.resize({cols: 120, rows: 60});
    const before = Array.from(
      {length: 24},
      (_, i) => `const value${i} = ${i};`,
    ).join('\n');
    await writeFile(join(host.directory, 'hunks.ts'), before);
    await host.invoke(
      'edit',
      JSON.stringify({
        path: 'hunks.ts',
        edits: [
          {oldText: 'const value0 = 0;', newText: 'const first = 100;'},
          {oldText: 'const value23 = 23;', newText: 'const last = 200;'},
        ],
      }),
    );
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('const last = 200;', {
      timeoutMs: 5000,
    });
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('Added 2 lines, removed 2 lines');
    expect(screen).toMatch(/1 \+ const first = 100;/u);
    expect(screen).toMatch(/24 \+ const last = 200;/u);
    expect(screen).not.toContain('Successfully replaced');
    await writeFile(join(host.directory, 'empty.txt'), 'remove');
    await host.invoke(
      'edit',
      JSON.stringify({
        path: 'empty.txt',
        edits: [{oldText: 'remove', newText: ''}],
      }),
    );
    expect(await host.terminal.screen.text()).toContain(
      'Added 0 lines, removed 1 line',
    );
    expect(await readFile(join(host.directory, 'empty.txt'), 'utf8')).toBe('');
  } finally {
    await host.close();
  }
}, 30000);
