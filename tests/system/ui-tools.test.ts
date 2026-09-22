import {expect, test} from 'bun:test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test('Bash previews three rows and expands retained output without changing the model result', async () => {
  const host = await launchPi('{"rtk":{"rewrite":false}}');
  try {
    const result = await host.invoke(
      'bash',
      JSON.stringify({
        command: "printf 'ALPHA\\nBETA\\nGAMMA\\nDELTA\\nEPSILON\\n'",
      }),
    );
    expect(result).toBe('ALPHA\nBETA\nGAMMA\nDELTA\nEPSILON\n');
    const compact = await host.terminal.screen.text();
    expect(compact).toContain('Bash(');
    expect(compact).toContain('⎿');
    expect(compact).toContain('2 more lines');
    expect(compact).not.toContain('· expand');
    expect(compact).not.toMatch(/^\s+EPSILON$/mu);
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitUntil(
      async () => /^\s+EPSILON$/mu.test(await host.terminal.screen.text()),
      {timeoutMs: 5000},
    );
    const expanded = await host.terminal.screen.text();
    expect(expanded).toMatch(/^\s+EPSILON$/mu);
    expect(expanded).not.toContain('2 more lines');
    expect(expanded).not.toContain('· collapse');
  } finally {
    await host.close();
  }
}, 30000);

test('Bash keeps timeout as a separate result block and retains host shell configuration', async () => {
  const host = await launchPi('{"rtk":{"rewrite":false}}');
  try {
    await writeFile(
      join(host.agent, 'settings.json'),
      JSON.stringify({
        shellPath: '/bin/bash',
        shellCommandPrefix: 'export UI_SHELL_MARKER=kept',
      }),
    );
    await host.reload();
    const result = await host.invoke(
      'bash',
      JSON.stringify({
        command: 'printf "%s\\n" "$UI_SHELL_MARKER"',
        timeout: 7,
      }),
    );
    expect(result).toBe('kept\n');
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('⎿ kept');
    expect(screen).toContain('⎿ timeout 7s');
    expect(screen).not.toContain('more lines');
  } finally {
    await host.close();
  }
}, 30000);

test('Global UI settings can disable tool presentation without changing execution', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false},"ui":{"enabled":false}}',
  );
  try {
    const result = await host.invoke(
      'bash',
      JSON.stringify({command: 'printf native'}),
    );
    expect(result).toBe('native');
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('$ printf native');
    expect(screen).not.toContain('Bash(');
  } finally {
    await host.close();
  }
}, 30000);

test('Global Bash preview limit changes visible rows while retaining the full result', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false},"ui":{"bashPreviewLines":1}}',
  );
  try {
    expect(
      await host.invoke(
        'bash',
        JSON.stringify({command: "printf 'one\\ntwo\\nthree\\n'"}),
      ),
    ).toBe('one\ntwo\nthree\n');
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('⎿ one');
    expect(screen).toContain('2 more lines');
    expect(screen).not.toMatch(/^\s+two$/mu);
  } finally {
    await host.close();
  }
}, 30000);

test('Write previews three source rows and reveals the complete written file', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false},"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  try {
    const content =
      'export const first = 1;\nexport const second = 2;\nexport const third = 3;\nexport const fourth = 4;\n';
    await host.invoke('write', JSON.stringify({path: 'sample.ts', content}));
    expect(await readFile(join(host.directory, 'sample.ts'), 'utf8')).toBe(
      content,
    );
    const compact = await host.terminal.screen.text();
    expect(compact).toContain('Write(sample.ts)');
    expect(compact).toContain('Wrote 4 lines');
    expect(compact).toContain('1 more line');
    expect(compact).not.toContain('export const fourth');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('export const fourth', {
      timeoutMs: 5000,
    });
  } finally {
    await host.close();
  }
}, 30000);

test('Edit displays real source line numbers and added/removed counts', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false},"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  try {
    await writeFile(
      join(host.directory, 'change.ts'),
      'function value() {\n  return 1;\n}\n',
    );
    await host.invoke(
      'edit',
      JSON.stringify({
        path: 'change.ts',
        edits: [
          {
            oldText: '  return 1;',
            newText: '  const result = 2;\n  return result;',
          },
        ],
      }),
    );
    expect(await readFile(join(host.directory, 'change.ts'), 'utf8')).toBe(
      'function value() {\n  const result = 2;\n  return result;\n}\n',
    );
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('Edit(change.ts)');
    expect(screen).toContain('Added 2 lines, removed 1 line');
    expect(screen).toMatch(/2 -\s+return 1;/u);
    expect(screen).toMatch(/2 \+\s+const result = 2;/u);
    expect(screen).toMatch(/3 \+\s+return result;/u);
  } finally {
    await host.close();
  }
}, 30000);

test('Edit disclosure uses the recorded patch after the file changes again', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false},"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  try {
    const before =
      Array.from(
        {length: 9},
        (_, index) => `const old${index} = ${index};`,
      ).join('\n') + '\n';
    const after =
      Array.from(
        {length: 9},
        (_, index) => `const next${index} = ${index + 1};`,
      ).join('\n') + '\n';
    const path = join(host.directory, 'history.ts');
    await writeFile(path, before);
    await host.invoke(
      'edit',
      JSON.stringify({
        path: 'history.ts',
        edits: [{oldText: before, newText: after}],
      }),
    );
    const compact = await host.terminal.screen.text();
    expect(compact).toContain('Added 9 lines, removed 9 lines');
    expect(compact).toContain('12 more lines');
    expect(compact).not.toContain('const next8');
    await writeFile(path, 'UNRELATED_CURRENT_FILE\n');
    await host.terminal.resize({cols: 80, rows: 48});
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('const next8 = 9;', {
      timeoutMs: 5000,
    });
    const expanded = await host.terminal.screen.text();
    expect(expanded).not.toContain('UNRELATED_CURRENT_FILE');
    expect(expanded).not.toContain('more lines');
  } finally {
    await host.close();
  }
}, 30000);

test('Read and Ls retain their native identity and reveal results only on disclosure', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false},"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  try {
    await writeFile(
      join(host.directory, 'retrieval.txt'),
      'RETRIEVAL_ONE\nRETRIEVAL_TWO\n',
    );
    expect(
      await host.invoke('read', JSON.stringify({path: 'retrieval.txt'})),
    ).toContain('RETRIEVAL_TWO');
    const compact = await host.terminal.screen.text();
    expect(compact).toContain('Read(retrieval.txt)');
    expect(compact).not.toContain('RETRIEVAL_TWO');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('RETRIEVAL_TWO', {timeoutMs: 5000});
    await host.invoke('ls', JSON.stringify({path: '.'}));
    expect(await host.terminal.screen.text()).toContain('Ls(.)');
    await host.invoke('bash', JSON.stringify({command: 'ls retrieval.txt'}));
    expect(await host.terminal.screen.text()).toContain(
      'Bash(ls retrieval.txt)',
    );
  } finally {
    await host.close();
  }
}, 30000);

test('Grep and Find keep native results and make no-match outcomes visible', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false},"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  try {
    await writeFile(join(host.directory, 'needle.txt'), 'distinctive_needle\n');
    expect(
      await host.invoke(
        'grep',
        JSON.stringify({pattern: 'distinctive_needle', path: 'needle.txt'}),
      ),
    ).toContain('distinctive_needle');
    expect(await host.terminal.screen.text()).toContain(
      'Grep(distinctive_needle, needle.txt)',
    );
    await host.invoke(
      'grep',
      JSON.stringify({pattern: 'NO_MATCH_TOKEN', path: 'needle.txt'}),
    );
    expect(await host.terminal.screen.text()).toContain('No matches found');
    expect(
      await host.invoke('find', JSON.stringify({pattern: '*.txt', path: '.'})),
    ).toContain('needle.txt');
    expect(await host.terminal.screen.text()).toContain('Find(*.txt, .)');
  } finally {
    await host.close();
  }
}, 30000);

test('Ls exposes upstream limits while keeping retained entries compact', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false},"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  try {
    await mkdir(join(host.directory, 'entries'));
    await writeFile(join(host.directory, 'entries/aaa.txt'), 'a');
    await writeFile(join(host.directory, 'entries/bbb.txt'), 'b');
    const result = await host.invoke(
      'ls',
      JSON.stringify({path: 'entries', limit: 1}),
    );
    expect(result).toContain('aaa.txt');
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('Result limit reached: 1');
    expect(screen).not.toContain('aaa.txt');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('aaa.txt', {timeoutMs: 5000});
  } finally {
    await host.close();
  }
}, 30000);

test('WebFetch and WebRead share retrieval disclosure and preserve retained content', async () => {
  const host = await launchPi(
    '{"ui":{"retrievalGroups":false}}',
    undefined,
    'web',
  );
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      new Response('WEB_BODY_ONE\nWEB_BODY_TWO\n', {
        headers: {'content-type': 'text/plain'},
      }),
  });
  try {
    const result = await host.invoke(
      'fetch_content',
      JSON.stringify({urls: [String(server.url)], mode: 'raw'}),
    );
    expect(result).toContain('WEB_BODY_TWO');
    const compact = await host.terminal.screen.text();
    expect(compact).toContain('WebFetch(');
    expect(compact).not.toContain('WEB_BODY_TWO');
    await host.terminal.keyboard.press('Control+O');
    await host.terminal.screen.waitForText('WEB_BODY_TWO', {timeoutMs: 5000});
    const id = /contentId: ([^\s]+)/u.exec(result)?.[1];
    expect(id).toBeDefined();
    await host.invoke(
      'get_search_content',
      JSON.stringify({contentId: id, find: 'WEB_BODY_TWO'}),
    );
    expect(await host.terminal.screen.text()).toContain('WebRead(');
  } finally {
    await server.stop(true);
    await host.close();
  }
}, 30000);

test('WebSearch exposes batch failure text even when the host result is not marked as an error', async () => {
  const host = await launchPi(
    '{"ui":{"retrievalGroups":false}}',
    undefined,
    'web',
  );
  try {
    await writeFile(
      join(host.agent, 'auth.json'),
      JSON.stringify({exa: {type: 'api_key', key: 'invalid\nfixture'}}),
    );
    const result = await host.invoke(
      'web_search',
      JSON.stringify({queries: ['offline authentication failure']}),
    );
    expect(result).toContain('error: authentication:');
    const screen = await host.terminal.screen.text();
    expect(screen).toContain('WebSearch(');
    expect(screen).toContain('error: authentication:');
    expect(screen).not.toContain('invalid');
  } finally {
    await host.close();
  }
}, 30000);
