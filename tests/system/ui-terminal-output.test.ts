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

test.each([
  ['regular', false],
  ['regular', true],
  ['fullscreen', false],
  ['fullscreen', true],
] as const)(
  'UI lifecycle emits no palette setters or resets (%s, UI enabled: %s)',
  async (mode, enabled) => {
    const host = await launchPi(
      JSON.stringify({rtk: {rewrite: false}, ui: {enabled}}),
      undefined,
      'ui',
      mode,
    );
    try {
      await host.command('/host-theme catppuccin-latte');
      await host.terminal.screen.waitForText('HOST_THEME:catppuccin-latte', {
        timeoutMs: 5000,
      });
      await host.start(
        'bash',
        JSON.stringify({command: 'echo RUNNING; sleep 60'}),
      );
      await host.terminal.screen.waitForText(/^\s*(?:⎿  )?RUNNING\s*$/mu, {
        timeoutMs: 5000,
      });
      await host.terminal.keyboard.press('Escape');
      await host.terminal.screen.waitForText(/aborted/iu, {timeoutMs: 5000});
      await host.command('/host-theme dark');
      await host.terminal.screen.waitForText('HOST_THEME:dark', {
        timeoutMs: 5000,
      });
      await host.invoke('bash', JSON.stringify({command: 'echo RECOVERED'}));
      await host.command('/quit');
      expect(await host.terminal.waitForExit({timeoutMs: 5000})).toMatchObject({
        reason: 'exited',
        exit: {code: 0, signal: null, success: true},
      });
      const transcript = await host.terminal.transcript.ansi();
      expect(new TextDecoder().decode(transcript)).toContain('RECOVERED');
      expect(paletteMutations(transcript)).toEqual([]);
    } finally {
      await host.close();
    }
  },
  30000,
);

// Xterm color OSCs: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
function paletteMutations(bytes: Uint8Array): string[] {
  const mutations: string[] = [];
  for (let offset = 0; offset < bytes.length; offset++) {
    const start = offset;
    if (bytes[offset] === 0x1b && bytes[offset + 1] === 0x5d) offset += 2;
    else if (bytes[offset] === 0x9d) offset++;
    else continue;
    const bodyStart = offset;
    while (
      offset < bytes.length &&
      bytes[offset] !== 0x07 &&
      bytes[offset] !== 0x9c &&
      bytes[offset] !== 0x1b
    )
      offset++;
    const body = Buffer.from(bytes.subarray(bodyStart, offset)).toString(
      'latin1',
    );
    const [selector = '', ...values] = body.split(';');
    const terminated =
      bytes[offset] === 0x07 ||
      bytes[offset] === 0x9c ||
      (bytes[offset] === 0x1b && bytes[offset + 1] === 0x5c);
    if (!terminated) {
      offset--;
      continue;
    }
    if (!/^[0-9]+$/u.test(selector)) continue;
    const code = Number(selector);
    const parameters = values.length ? `;${values.join(';')}` : '';
    const mutation =
      code >= 10 && code <= 19
        ? !/^(?:;\?)+$/u.test(parameters)
        : code === 4 || code === 5
          ? !/^(?:;[0-9]+;\?)+$/u.test(parameters)
          : code === 6 ||
            (code >= 104 && code <= 106) ||
            (code >= 110 && code <= 119);
    const end = offset + (bytes[offset] === 0x1b ? 2 : 1);
    if (mutation)
      mutations.push(
        Buffer.from(bytes.subarray(start, end)).toString('latin1'),
      );
    offset = end - 1;
  }
  return mutations;
}

test('Palette assertions distinguish raw setters, resets and queries', () => {
  for (const begin of ['\x1b]', '\x9d']) {
    for (const end of ['\x07', '\x1b\\', '\x9c']) {
      for (const body of [
        '4;1;#123456;2;?',
        '5;0;#123456',
        '6;1;1',
        '010;#123456',
        '11;?;#123456',
        '104',
        '105;1',
        '106;0;1',
        '110',
        '119',
      ]) {
        const sequence = `${begin}${body}${end}`;
        expect(paletteMutations(Buffer.from(sequence, 'latin1'))).toEqual([
          sequence,
        ]);
      }
      for (const body of ['4;1;?;2;?', '5;0;?', '010;?;?', '0;window title']) {
        expect(
          paletteMutations(Buffer.from(`${begin}${body}${end}`, 'latin1')),
        ).toEqual([]);
      }
    }
  }
});
