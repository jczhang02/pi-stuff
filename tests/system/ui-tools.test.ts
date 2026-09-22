import {expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
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
