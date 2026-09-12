import {expect, test} from 'bun:test';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {launchTerminal, type Session} from 'tuistory';
import {createFixture, messageText} from './fixture';
import {isolatedEnvironment} from './environment';

function screen(terminal: Session) {
  return terminal
    .getTerminalData()
    .lines.slice(-terminal.currentRows)
    .map(line => line.spans.map(span => span.text).join(''))
    .join('\n');
}

test('Arhen default UI in compiled Pi: real background tools and peek', async () => {
  const fixture = await createFixture();
  const terminal = await launchTerminal({
    command: '/opt/bin/pi',
    args: [
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
      'development',
      '-e',
      process.env.PI_E2E_BASELINE ??
        resolve('node_modules/@arhen/pi-core-subagent/src/index.ts'),
    ],
    cwd: fixture.cwd,
    cols: 140,
    rows: 42,
    env: isolatedEnvironment(fixture.directory, fixture.agentDir),
  });
  try {
    await terminal.waitForText('development', {timeout: 15000});
    await terminal.type('检查任务取消流程');
    await terminal.press('enter');
    await terminal.text({
      timeout: 15000,
      waitFor: () =>
        existsSync(join(fixture.directory, 'main.progress')) &&
        existsSync(join(fixture.directory, 'reviewer.progress')),
    });
    expect(fixture.requests.length).toBeGreaterThan(5);
    await terminal.type('/subagents peek');
    await terminal.press('enter');
    await terminal.text({
      timeout: 5000,
      waitFor: () =>
        screen(terminal).includes('╭') &&
        screen(terminal).includes('Subagents'),
    });
    expect(screen(terminal)).toContain('Follow-up:');
    console.log(
      'PASS baseline: actual Arhen peek, background tools and visible Follow-up queue.',
    );
  } catch (error) {
    console.error(screen(terminal));
    throw error;
  } finally {
    try {
      terminal.killProcess();
      expect(await terminal.waitForExit(5000)).toBe(true);
    } finally {
      terminal.close();
      await fixture.close();
    }
  }
}, 40000);

for (const profile of ['sdk', 'compiled'] as const) {
  test(`adapted Arhen ${profile}: live conversations, directed input and history`, async () => {
    const fixture = await createFixture();
    const terminal = await launchTerminal({
      command: profile === 'sdk' ? process.execPath : '/opt/bin/pi',
      args:
        profile === 'sdk'
          ? [resolve('tools/subagent-runtime-e2e/host.ts')]
          : [
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
              'development',
              '-e',
              resolve('tools/subagent-runtime-e2e/extension.ts'),
            ],
      cwd: fixture.cwd,
      cols: 140,
      rows: 42,
      env: isolatedEnvironment(fixture.directory, fixture.agentDir),
    });
    const see = (text: string) =>
      terminal.text({
        timeout: 10000,
        waitFor: () => screen(terminal).includes(text),
      });
    const progress = (role: string) => {
      const path = join(fixture.directory, `${role}.progress`);
      return existsSync(path)
        ? readFileSync(path, 'utf8').split('\n').length
        : 0;
    };
    async function select(index: number) {
      await terminal.press('down');
      for (let i = 0; i < index; i++) await terminal.press('down');
      await terminal.press('enter');
    }
    try {
      await see('空输入 ↓ 选择代理');
      await terminal.type('检查任务取消流程');
      await terminal.press('enter');
      await terminal.text({
        timeout: 15000,
        waitFor: () =>
          progress('main') > 1 &&
          progress('reviewer') > 1 &&
          screen(terminal).includes('explorer'),
      });
      const initial = screen(terminal);
      expect(initial).not.toContain('Follow-up:');
      const footer = initial.lastIndexOf('development');
      expect(footer).toBeGreaterThan(-1);
      if (profile === 'sdk')
        expect(footer).toBeLessThan(initial.indexOf('main *'));
      else expect(footer).toBeGreaterThan(initial.indexOf('main *'));
      await select(3);
      await see('发送给 explorer');
      await terminal.type('提前继续定位');
      await terminal.press('enter');
      await see('wait for it to settle before resuming');
      expect(screen(terminal)).toContain('提前继续定位');
      await terminal.press(['ctrl', 'c']);
      await see('main *');
      await select(1);
      await see('发送给 reviewer');
      await terminal.text({
        timeout: 5000,
        waitFor: () => /reviewer \d/.test(screen(terminal)),
      });
      const elapsed = screen(terminal).match(/Elapsed ([\d.]+)s/);
      expect(elapsed).not.toBeNull();
      expect(Number(elapsed?.[1])).toBeGreaterThan(2);
      const before = progress('main');
      await terminal.text({
        timeout: 5000,
        waitFor: () => progress('main') > before + 2,
      });
      await terminal.press(['ctrl', 'o']);
      for (
        let page = 0;
        page < 12 && !screen(terminal).includes('export function cancel');
        page++
      )
        await terminal.press('pageup');
      await see('export function cancel');
      await terminal.press(['ctrl', 'end']);
      await terminal.type('只补充审查释放路径');
      await terminal.press('enter');
      await see('补充消息待处理');
      await fixture.release('reviewer');
      await see('已收到 reviewer 的补充：只补充审查释放路径');
      expect(
        fixture.requests.some(
          request =>
            messageText(
              request.messages.find(message => message.role === 'user'),
            ).includes('检查任务取消流程') &&
            request.messages.some(message =>
              messageText(message).includes('只补充审查释放路径'),
            ),
        ),
      ).toBe(false);
      await terminal.type('reviewer 草稿');
      await terminal.press(['ctrl', 'c']);
      await see('main *');
      await select(1);
      await see('reviewer 草稿');
      await terminal.press(['ctrl', 'c']);
      await see('main *');
      await select(2);
      await see('发送给 tester');
      await terminal.press(['ctrl', 'o']);
      await see('是否检查连续取消两次？');
      await terminal.type('是，检查连续取消两次');
      await terminal.press('enter');
      await terminal.text({
        timeout: 10000,
        waitFor: () => progress('tester') > 1,
      });
      await fixture.release('tester');
      await see('连续取消测试失败');
      await see('Command exited with code 1');
      await terminal.press(['ctrl', 'c']);
      await see('main *');
      await select(3);
      await see('发送给 explorer');
      await terminal.press(['ctrl', 'u']);
      await terminal.type('继续定位释放路径');
      await terminal.press('enter');
      await see('已收到 explorer 的补充：继续定位释放路径');
      await terminal.press(['ctrl', 'o']);
      await terminal.press('pageup');
      await see('export function cancel');
      await terminal.press(['ctrl', 'end']);
      await terminal.resize({cols: 62, rows: 28});
      await see('发送给 explorer');
      expect(screen(terminal)).toContain('↑ ');
      await terminal.resize({cols: 40, rows: 16});
      await see('至少需要 50 列');
      await terminal.press(['ctrl', 'c']);
      await terminal.resize({cols: 140, rows: 42});
      await see('main *');
      await fixture.release('main');
      // Fullscreen redraws can remove the final answer from PTY scrollback while
      // queued notices run. Check the real persisted assistant entry instead.
      await terminal.text({
        timeout: 10000,
        waitFor: () =>
          readdirSync(fixture.agentDir, {
            recursive: true,
            withFileTypes: true,
          }).some(
            file =>
              file.isFile() &&
              file.name.endsWith('.jsonl') &&
              readFileSync(join(file.parentPath, file.name), 'utf8').includes(
                '"text":"main 检查完成。',
              ),
          ),
      });
      expect(screen(terminal)).not.toContain('Follow-up:');
      console.log(
        `PASS ${profile}: background continued; reviewer-only steering; native history/tools; reply; tool failure; settled continuation; drafts; resize. ${profile === 'compiled' ? 'LIMIT: Fleet is above native footer because public append API is absent.' : 'Native footer above Fleet verified.'}`,
      );
    } catch (error) {
      console.error(screen(terminal));
      throw error;
    } finally {
      try {
        terminal.killProcess();
        expect(await terminal.waitForExit(5000)).toBe(true);
      } finally {
        terminal.close();
        await fixture.close();
      }
    }
  }, 90000);
}
