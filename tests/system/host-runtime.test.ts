import {expect, test} from 'bun:test';
import {launchPi} from './fixtures/pi-terminal';

test('the loaded package runs inside the selected Pi and Bun host', async () => {
  const expected = process.env.PI_TEST_VERSION ?? '0.87.1';
  if (process.env.PI_TEST_VERSION && !process.env.PI_TEST_HOST)
    throw new Error('PI_TEST_VERSION requires an explicit PI_TEST_HOST');
  const host = await launchPi();
  try {
    await host.command('/host-runtime');
    await host.terminal.screen.waitForText('HOST_RUNTIME:', {timeoutMs: 5000});
    const screen = await host.terminal.screen.text();
    const identity = screen.match(/HOST_RUNTIME:pi=([^:]+):bun=([^\s]+)/);
    expect(identity?.[1]).toBe(expected);
    expect(identity?.[2]).toMatch(/^\d+\.\d+\.\d+/);
    console.info(identity?.[0]);
  } finally {
    await host.close();
  }
}, 30000);
