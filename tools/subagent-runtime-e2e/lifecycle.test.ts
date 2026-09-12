import {expect, test} from 'bun:test';
import {existsSync, readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {launchTerminal, type Session} from 'tuistory';
import {createFixture} from './fixture';
import {isolatedEnvironment} from './environment';

function screen(terminal: Session) {
  return terminal
    .getTerminalData()
    .lines.slice(-terminal.currentRows)
    .map(line => line.spans.map(span => span.text).join(''))
    .join('\n');
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

for (const profile of ['sdk', 'compiled'] as const) {
  test(`${profile}: scoped stop, provider failure, session recovery, new session and shutdown`, async () => {
    const fixture = await createFixture();
    const companion = join(fixture.directory, 'companion.ts');
    await writeFile(
      companion,
      `
import {CustomEditor, type ExtensionAPI} from ${JSON.stringify(resolve('node_modules/@earendil-works/pi-coding-agent/dist/index.js'))};
import {matchesKey} from ${JSON.stringify(resolve('node_modules/@earendil-works/pi-tui/dist/index.js'))};
export default function(pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    ctx.ui.setFooter(() => ({invalidate() {}, render() { return ['existing footer']; }}));
    ctx.ui.setEditorComponent((tui, theme, keys) => {
      const editor = new CustomEditor(tui, theme, keys);
      const handle = editor.handleInput.bind(editor);
      editor.handleInput = data => {
        if (matchesKey(data, 'f6')) editor.setText('existing editor binding');
        else handle(data);
      };
      return editor;
    });
  });
}`,
    );
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
              companion,
              '-e',
              resolve('tools/subagent-runtime-e2e/extension.ts'),
            ],
      cwd: fixture.cwd,
      cols: 140,
      rows: 42,
      env: {
        ...isolatedEnvironment(fixture.directory, fixture.agentDir),
        PI_E2E_COMPANION: companion,
      },
    });
    const wait = (predicate: () => boolean) =>
      terminal.text({timeout: 10000, waitFor: predicate});
    const see = (text: string) => wait(() => screen(terminal).includes(text));
    const progress = (role: string) => {
      const path = join(fixture.directory, `${role}.progress`);
      return existsSync(path)
        ? readFileSync(path, 'utf8').split('\n').length
        : 0;
    };
    const pid = (role: string) =>
      Number(readFileSync(join(fixture.directory, `${role}.pid`), 'utf8'));
    async function select(index: number) {
      await terminal.press('down');
      for (let i = 0; i < index; i++) await terminal.press('down');
      await terminal.press('enter');
    }
    let mainPid = 0;
    let reviewerPid = 0;
    try {
      await see('空输入 ↓ 选择代理');
      if (profile === 'compiled')
        expect(screen(terminal)).toContain('existing footer');
      else expect(screen(terminal)).not.toContain('existing footer');
      await terminal.press('f6');
      await see('existing editor binding');
      await terminal.press(['ctrl', 'u']);
      await terminal.type('检查任务取消流程');
      await terminal.press('enter');
      await wait(
        () =>
          progress('main') > 2 &&
          progress('reviewer') > 2 &&
          screen(terminal).includes('tester'),
      );
      mainPid = pid('main');
      reviewerPid = pid('reviewer');
      expect(alive(mainPid)).toBe(true);
      expect(alive(reviewerPid)).toBe(true);
      await select(1);
      await see('发送给 reviewer');
      await terminal.press('escape');
      await wait(() => !alive(reviewerPid));
      await see('发送给 reviewer');
      const before = progress('main');
      await wait(() => progress('main') > before + 2);
      expect(screen(terminal)).toContain('? tester');
      await terminal.press(['ctrl', 'c']);
      await see('main *');
      // x cancels the waiting question; a second x is harmless.
      await terminal.press('down');
      await terminal.press('down');
      await terminal.press('down');
      await terminal.type('x');
      await see('■ tester');
      await terminal.type('x');
      await terminal.press('escape');
      await select(1);
      await see('发送给 reviewer');
      await terminal.type('触发模型错误');
      await terminal.press('enter');
      await see('controlled provider failure');
      await terminal.type('继续检查取消后的状态');
      await terminal.press('enter');
      await see('已收到 reviewer 的补充：继续检查取消后的状态');
      await terminal.press(['ctrl', 'o']);
      await terminal.press('pageup');
      await see('export function cancel');
      expect(alive(mainPid)).toBe(true);
      await terminal.press(['ctrl', 'c']);
      await see('main *');
      // /new must end the old main process and clear the old Fleet.
      await terminal.type('/new');
      await terminal.press('enter');
      await wait(
        () => !alive(mainPid) && !screen(terminal).includes('reviewer'),
      );
      await see('空输入 ↓ 选择代理');
      await terminal.type('/reload');
      await terminal.press('enter');
      await see('Reloaded');
      await terminal.press('f6');
      await see('existing editor binding');
      await terminal.press(['ctrl', 'u']);
      const mainBefore = progress('main');
      const reviewerBefore = progress('reviewer');
      await terminal.type('检查任务取消流程');
      await terminal.press('enter');
      await wait(
        () =>
          progress('main') > mainBefore + 2 &&
          progress('reviewer') > reviewerBefore + 2,
      );
      mainPid = pid('main');
      reviewerPid = pid('reviewer');
      expect(alive(reviewerPid)).toBe(true);
      // Parent Esc aborts only the parent; its waiting/running children stay observable.
      await terminal.press('escape');
      await wait(() => !alive(mainPid));
      expect(alive(reviewerPid)).toBe(true);
      // Native Ctrl+D shutdown must release both children and pending questions.
      await terminal.press(['ctrl', 'd']);
      expect(await terminal.waitForExit(10000)).toBe(true);
      const deadline = Date.now() + 5000;
      while (alive(reviewerPid) && Date.now() < deadline) await Bun.sleep(50);
      expect(alive(reviewerPid)).toBe(false);
      console.log(
        `PASS ${profile}: real worker cancellation, sibling isolation, double stop, model failure/recovery, retained history, /new, /reload, existing editor binding, parent abort, graceful shutdown. ${profile === 'sdk' ? 'LIMIT: SDK native-footer layout replaces the companion footer.' : 'Existing companion footer preserved.'}`,
      );
    } catch (error) {
      console.error(screen(terminal));
      throw error;
    } finally {
      terminal.killProcess();
      await terminal.waitForExit(5000);
      terminal.close();
      // Rescue only this test's known workers on a failed lifecycle assertion.
      for (const knownPid of [mainPid, reviewerPid]) {
        if (knownPid && alive(knownPid)) process.kill(knownPid, 'SIGTERM');
      }
      await fixture.close();
    }
  }, 90000);
}
