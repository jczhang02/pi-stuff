import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';

test('Pi removes ANSI from the model-bound Bash result without RTK', async () => {
  const host = await launchPi();
  try {
    const output = await host.invoke(
      'bash',
      JSON.stringify({command: "printf '\\033[31mRED ERROR\\033[0m 中文\\n'"}),
    );
    expect(output).toBe('RED ERROR 中文\n');
  } finally {
    await host.close();
  }
}, 30000);
