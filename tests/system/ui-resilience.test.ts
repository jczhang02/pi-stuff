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
