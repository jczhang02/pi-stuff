// Drives real submission, cancellation, retry, scrolling and resize outside the UI.
import type {Session} from '@kitlangton/terminal-control';
export async function captureLive(
  session: Session,
  responseError: boolean,
  cancel: boolean,
  save: (label: string, expected: readonly string[]) => Promise<void>,
): Promise<void> {
  const wait = {timeoutMs: 45000};
  await session.screen.waitForText('Welcome back!', wait);
  await save('welcome', ['Welcome back!', '分页边界']);
  await session.keyboard.press('Enter');
  await session.screen.waitForText('Thinking', wait);
  await save('thinking', ['Thinking']);
  if (responseError) {
    await session.screen.waitForText('HTTP 503', wait);
    const text = await session.screen.text();
    if (text.includes('⎿'))
      throw new Error('Response error acquired tool chrome');
    await save('response-failed', ['HTTP 503']);
    await session.keyboard.type('请重试刚才的请求.');
    await session.keyboard.press('Enter');
  }
  await session.screen.waitForText('Running', wait);
  if (cancel) {
    await session.keyboard.type('保留草稿, 稍后继续');
    await session.keyboard.press('Escape');
    await session.screen.waitForText('Operation aborted', wait);
    await save('cancelled', ['Cancelled', 'Operation aborted', '保留草稿']);
    const stopped = await session.screen.text();
    await Bun.sleep(1800);
    if ((await session.screen.text()) !== stopped)
      throw new Error('Cancelled timeline advanced');
    await session.keyboard.press('Control+U');
    await session.keyboard.type('继续, 保留已经完成的检查.');
    await session.keyboard.press('Enter');
  }
  await session.screen.waitForText('Read 1 file', wait);
  await save('group-growing', ['Read 1 file']);
  await session.screen.waitForText('HTTP 404', wait);
  await save('web-recovery', ['HTTP 404']);
  await session.screen.waitForText(
    '页内重复与全空过滤页还可以单独补充覆盖.',
    wait,
  );
  await save('first-complete', ['8 项测试通过']);
  const firstScreen = (await session.screen.text()).split('\n');
  const editLine = firstScreen.findIndex(line => line.includes('• Edit('));
  if (editLine < 0) throw new Error('Edit not visible for live mouse probe');
  await session.mouse({action: 'click', x: 3, y: editLine, button: 'left'});
  await session.screen.waitForText(
    'Added 2 lines, removed 1 line · collapse',
    wait,
  );
  await save('edit-clicked', [
    'Added 2 lines, removed 1 line · collapse',
    '8 项测试通过',
  ]);
  await session.keyboard.type('补充页内重复和全空过滤页, 展示完整测试结果.');
  await session.keyboard.press('Enter');
  await session.screen.waitForText('10 项测试通过', wait);
  await session.screen.waitForText('无输出.', wait);
  await session.keyboard.type('下一条草稿不会被展开操作覆盖');
  await save('followup-complete', ['10 项测试通过', '下一条草稿']);
  await session.keyboard.press('Control+O');
  await session.screen.waitForText('Tool output: expanded', wait);
  await save('expanded-tail', ['下一条草稿', '10 项测试通过']);
  const beforeScroll = await session.screen.text();
  await session.keyboard.press('PageUp');
  await session.screen.waitUntil(
    screen =>
      screen.text !== beforeScroll &&
      screen.text.includes('[pass] preserves the cursor'),
    wait,
  );
  await save('output-scrolled', ['[pass] preserves the cursor']);
  const wide = (await session.screen.frame()).cols;
  await session.resize({cols: 60, rows: 40});
  await session.screen.waitUntil(
    screen => screen.frame.cols === 60 && screen.text.includes('│ "next"};'),
    {timeoutMs: 10000},
  );
  await save('narrow-scrolled', ['│ "next"};']);
  for (let i = 0; i < 12; i++) await session.keyboard.press('PageUp');
  await session.screen.waitForText('分页边界', wait);
  await save('history-start', ['分页边界']);
  for (let i = 0; i < 16; i++) await session.keyboard.press('PageDown');
  await session.screen.waitForText('下一条草稿', wait);
  await session.resize({cols: wide, rows: 40});
  await session.keyboard.press('Control+O');
  await session.screen.waitForText('Tool output: collapsed', wait);
  await save('restored', ['下一条草稿', '10 项测试通过']);
}
