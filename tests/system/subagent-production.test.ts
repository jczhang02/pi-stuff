import {expect, test} from 'bun:test';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {launchTerminal, type Session} from 'tuistory';
import {createSubagentFixture} from './fixtures/subagent-runtime';

function environment(directory: string, agentDir: string) {
  return {
    ...Object.fromEntries(
      Object.keys(process.env).map(key => [key, undefined]),
    ),
    PATH: process.env.PATH,
    HOME: directory,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'C.UTF-8',
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: join(agentDir, 'sessions'),
    PI_OFFLINE: '1',
    PI_TELEMETRY: '0',
    NO_PROXY: 'localhost,127.0.0.1',
  };
}

function screen(terminal: Session): string {
  return terminal
    .getTerminalData()
    .lines.slice(-terminal.currentRows)
    .map(line => line.spans.map(span => span.text).join(''))
    .join('\n');
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean,
  timeout = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await Bun.sleep(50);
  expect(predicate()).toBe(true);
}

test('production Pi host runs the offline subagent fleet through its public UI', async () => {
  const fixture = await createSubagentFixture();
  const terminal = await launchTerminal({
    command: process.env.PI_TEST_HOST ?? process.execPath,
    args: [
      ...(process.env.PI_TEST_HOST
        ? []
        : [
            resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
          ]),
      '--offline',
      '--no-extensions',
      '--no-skills',
      '--no-context-files',
      '--no-prompt-templates',
      '--no-themes',
      '--no-approve',
      '--provider',
      'local',
      '--model',
      'subagent-fixture',
      '-e',
      resolve('src/pi/index.ts'),
    ],
    cwd: fixture.cwd,
    cols: 140,
    rows: 42,
    env: environment(fixture.directory, fixture.agentDir),
  });
  const pid = (role: string) =>
    Number(readFileSync(join(fixture.directory, `${role}.pid`), 'utf8'));
  try {
    await terminal.waitForText('subagent-fixture', {timeout: 15_000});
    expect(screen(terminal)).toContain('0.0%');
    await terminal.type('检查任务取消流程');
    await terminal.press('enter');
    await terminal.waitForText('reviewer', {timeout: 15_000});
    await terminal.waitForText('tester', {timeout: 15_000});
    await terminal.waitForText('explorer', {timeout: 15_000});
    expect(fixture.requests.length).toBeGreaterThan(5);
    const mainPid = pid('main');
    expect(alive(mainPid)).toBe(true);

    // The main continuation is allowed while sibling workers are still held.
    expect(screen(terminal)).toContain('reviewer');

    // First Down focuses main; the second selects the first child.
    await terminal.press('down');
    await terminal.press('down');
    await terminal.press('enter');
    await terminal.text({
      timeout: 5000,
      waitFor: () => screen(terminal).includes('Message @reviewer'),
    });
    expect(alive(mainPid)).toBe(true);
    await terminal.type('保留的 reviewer 草稿');
    await terminal.press(['ctrl', 'c']);
    await terminal.text({
      timeout: 5000,
      waitFor: () => screen(terminal).includes('Message @main'),
    });
    expect(alive(mainPid)).toBe(true);

    // Ctrl+O expands the selected child transcript; paging and resize use the real screen.
    await terminal.type('/subagents');
    await terminal.press('enter');
    await terminal.text({
      timeout: 5000,
      waitFor: () => screen(terminal).includes('保留的 reviewer 草稿'),
    });
    await terminal.press(['ctrl', 'u']);
    await terminal.press(['ctrl', 'o']);
    await terminal.press('pageup');
    await terminal.press('pagedown');
    await terminal.resize({cols: 72, rows: 24});
    expect(screen(terminal)).toContain('reviewer');
    await terminal.press('escape');
    await terminal.resize({cols: 140, rows: 42});
    expect(
      readdirSync(fixture.agentDir, {recursive: true}).some(file =>
        String(file).endsWith('.pi-stuff-subagents.json'),
      ),
    ).toBe(true);

    expect(alive(mainPid)).toBe(true);
    // Answer only the waiting tester, then continue after its tool failure.
    await terminal.press('down');
    await terminal.press('down');
    await terminal.press('down');
    await terminal.press('up');
    await terminal.press('enter');
    await terminal.press(['ctrl', 'o']);
    await terminal.waitForText('是否检查连续取消两次', {timeout: 10_000});
    await terminal.type('是，检查连续取消两次');
    await terminal.press('enter');
    await fixture.release('tester');
    await terminal.waitForText('连续取消测试失败', {timeout: 15_000});
    await terminal.type('继续验证恢复');
    await terminal.press('enter');
    await terminal.waitForText('已收到 tester 的补充', {timeout: 15_000});
    await terminal.press(['ctrl', 'c']);

    // Release all fixture workers and verify their real process output before shutdown.
    await fixture.release('reviewer');
    await fixture.release('tester');
    await fixture.release('main');
    await terminal.press(['ctrl', 'c']);
    await waitUntil(() => !alive(mainPid), 5_000);
  } catch (error) {
    console.error(screen(terminal));
    throw error;
  } finally {
    try {
      terminal.killProcess();
      expect(await terminal.waitForExit(10_000)).toBe(true);
    } finally {
      terminal.close();
      await fixture.close();
    }
  }
}, 90_000);

test('production shutdown and reload release only owned workers and restore sessions', async () => {
  const fixture = await createSubagentFixture();
  const terminal = await launchTerminal({
    command: process.env.PI_TEST_HOST ?? process.execPath,
    args: [
      ...(process.env.PI_TEST_HOST
        ? []
        : [
            resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
          ]),
      '--offline',
      '--no-extensions',
      '--no-skills',
      '--no-context-files',
      '--no-prompt-templates',
      '--no-themes',
      '--no-approve',
      '--provider',
      'local',
      '--model',
      'subagent-fixture',
      '-e',
      resolve('src/pi/index.ts'),
    ],
    cwd: fixture.cwd,
    cols: 120,
    rows: 36,
    env: environment(fixture.directory, fixture.agentDir),
  });
  let workerPid = 0;
  const outsider = Bun.spawn(
    [process.execPath, '-e', 'setTimeout(() => {}, 120000)'],
    {stdout: 'ignore', stderr: 'ignore'},
  );
  try {
    await terminal.waitForText('0.0%', {timeout: 15_000});
    await terminal.type('检查任务取消流程');
    await terminal.press('enter');
    await waitUntil(() => existsSync(join(fixture.directory, 'reviewer.pid')));
    workerPid = Number(
      readFileSync(join(fixture.directory, 'reviewer.pid'), 'utf8'),
    );
    await fixture.release('main');
    await waitUntil(() =>
      readFileSync(join(fixture.directory, 'main.progress'), 'utf8').includes(
        'released',
      ),
    );
    await terminal.type('/reload');
    await terminal.press('enter');
    await terminal.waitForText('Reloaded', {timeout: 10_000});
    await waitUntil(() => !alive(workerPid), 5_000);
    expect(alive(outsider.pid)).toBe(true);
    await terminal.type('/subagents');
    await terminal.press('enter');
    await terminal.text({
      timeout: 5000,
      waitFor: () => screen(terminal).includes('Message @reviewer'),
    });
    await terminal.press(['ctrl', 'c']);
    await terminal.press(['ctrl', 'd']);
    expect(await terminal.waitForExit(10_000)).toBe(true);
    await waitUntil(() => !alive(workerPid), 5_000);
    expect(alive(outsider.pid)).toBe(true);
  } catch (error) {
    console.error(screen(terminal));
    throw error;
  } finally {
    terminal.killProcess();
    await terminal.waitForExit(5_000).catch(() => false);
    terminal.close();
    outsider.kill();
    await outsider.exited;
    await fixture.close();
  }
}, 60_000);
