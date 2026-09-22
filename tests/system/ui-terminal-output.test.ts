import {expect, test} from 'bun:test';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {launchPi} from './fixtures/pi-terminal';

test.each([false, true])(
  'Retrieval display ignores palette commands without RTK cleanup (UI enabled: %s)',
  async enabled => {
    const host = await launchPi(
      JSON.stringify({
        rtk: {rewrite: false, ansi: false},
        ui: {enabled, retrievalGroups: false},
      }),
      undefined,
      'ui',
    );
    const palette = '\x1b]10;#123456\x07';
    const payload = `${palette}RETAINED_CONTROL_BODY\n`;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        new Response(payload, {
          headers: {'content-type': 'text/plain'},
        }),
    });
    try {
      await writeFile(join(host.directory, 'control.txt'), payload);
      expect(
        await host.invoke('read', JSON.stringify({path: 'control.txt'})),
      ).toBe(payload);
      await host.terminal.keyboard.press('Control+O');
      await host.terminal.screen.waitForText('RETAINED_CONTROL_BODY', {
        timeoutMs: 5000,
      });
      expect(
        new TextDecoder()
          .decode(await host.terminal.transcript.ansi())
          .includes(palette),
      ).toBe(false);
      expect(
        await host.invoke(
          'fetch_content',
          JSON.stringify({
            urls: [String(server.url)],
            mode: 'raw',
          }),
        ),
      ).toContain(payload);
      expect(
        new TextDecoder()
          .decode(await host.terminal.transcript.ansi())
          .includes(palette),
      ).toBe(false);
    } finally {
      try {
        await server.stop(true);
      } finally {
        await host.close();
      }
    }
  },
  30000,
);

test('Error result blocks ignore palette commands without RTK cleanup', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false,"ansi":false}}',
    undefined,
    'ui',
  );
  const palette = '\x1b]10;#123456\x07';
  try {
    const failure = await host.invoke(
      'read',
      JSON.stringify({
        path: `missing-${palette}.txt`,
      }),
    );
    expect(failure).toContain('ENOENT');
    expect(failure).toContain(palette);
    expect(await host.terminal.screen.text()).toContain('ENOENT');
    expect(
      new TextDecoder()
        .decode(await host.terminal.transcript.ansi())
        .includes(palette),
    ).toBe(false);
  } finally {
    await host.close();
  }
}, 30000);

test('Tool display does not send retained terminal palette commands to the terminal', async () => {
  const host = await launchPi(
    '{"rtk":{"rewrite":false},"ui":{"retrievalGroups":false}}',
    undefined,
    'ui',
  );
  const palette = '\x1b]10;#123456\x07';
  const payload = `${palette}PALETTE_BODY\n`;
  try {
    expect(
      await host.invoke(
        'bash',
        JSON.stringify({
          command: "printf '\\033]10;#123456\\007PALETTE_BODY\\n'",
        }),
      ),
    ).toBe('PALETTE_BODY\n');
    expect(await host.terminal.screen.text()).toContain('PALETTE_BODY');
    expect(
      new TextDecoder()
        .decode(await host.terminal.transcript.ansi())
        .includes(palette),
    ).toBe(false);

    expect(
      await host.invoke(
        'bash',
        JSON.stringify({
          command: `printf HEADER_SAFE; # ${palette}`,
        }),
      ),
    ).toBe('HEADER_SAFE');
    expect(
      new TextDecoder()
        .decode(await host.terminal.transcript.ansi())
        .includes(palette),
    ).toBe(false);

    await writeFile(join(host.directory, 'control.txt'), payload);
    expect(
      await host.invoke('read', JSON.stringify({path: 'control.txt'})),
    ).toBe('PALETTE_BODY\n');
    await host.terminal.keyboard.press('Control+O');
    expect(
      new TextDecoder()
        .decode(await host.terminal.transcript.ansi())
        .includes(palette),
    ).toBe(false);

    const before = `${palette}const value = 1;\n`;
    await host.invoke(
      'write',
      JSON.stringify({path: 'control.txt', content: before}),
    );
    expect(await readFile(join(host.directory, 'control.txt'), 'utf8')).toBe(
      before,
    );
    expect(
      new TextDecoder()
        .decode(await host.terminal.transcript.ansi())
        .includes(palette),
    ).toBe(false);
    await host.invoke(
      'edit',
      JSON.stringify({
        path: 'control.txt',
        edits: [{oldText: before, newText: `${palette}const value = 2;\n`}],
      }),
    );
    expect(await readFile(join(host.directory, 'control.txt'), 'utf8')).toBe(
      `${palette}const value = 2;\n`,
    );
    expect(
      new TextDecoder()
        .decode(await host.terminal.transcript.ansi())
        .includes(palette),
    ).toBe(false);
  } finally {
    await host.close();
  }
}, 30000);
