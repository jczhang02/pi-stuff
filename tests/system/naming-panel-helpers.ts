import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Effect} from 'effect';
import {readConfiguration} from '../../src/pi/configuration';
import type {launchPi} from './fixtures/pi-terminal';

export type NamingHost = Awaited<ReturnType<typeof launchPi>>;

export async function openNamingSettings(host: NamingHost) {
  await host.command('/autoname panel');
  await host.terminal.screen.waitForText('Generate name', {timeoutMs: 4000});
  await host.terminal.keyboard.press('Enter');
  await host.terminal.screen.waitForText('AutoName / Settings', {
    timeoutMs: 4000,
  });
}
export async function backToNamingHome(host: NamingHost) {
  await host.terminal.keyboard.press('Escape');
  await host.terminal.screen.waitForText('Current name', {timeoutMs: 4000});
}
export async function closeNamingHome(host: NamingHost) {
  await host.terminal.keyboard.press('Escape');
  await host.terminal.screen.waitUntil(
    screen => !screen.text.includes('Generate name'),
    {timeoutMs: 4000},
  );
}
export async function namingConfiguration(host: NamingHost) {
  return Effect.runPromise(
    readConfiguration(
      Effect.succeed(await readFile(join(host.agent, 'pi-stuff.json'), 'utf8')),
    ),
  );
}
