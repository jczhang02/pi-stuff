// One-command shared foreground prototype. Ctrl+D exits and deletes scratch state.
import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {getAgentDir} from '@earendil-works/pi-coding-agent';
import {Schema} from 'effect';
import {sandbox, terminalBinary, runEffect} from './launch';
const args = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    theme: {type: 'string'},
    name: {type: 'string', default: 'pi-ui-session'},
  },
});
await runEffect(async () => {
  const settings = join(getAgentDir(), 'settings.json');
  const theme =
    args.values.theme ??
    Schema.decodeUnknownSync(Schema.Struct({theme: Schema.String}))(
      JSON.parse(await readFile(settings, 'utf8')),
    ).theme;
  if (theme !== 'catppuccin-mocha' && theme !== 'catppuccin-latte')
    throw new Error(
      'This preview supports Catppuccin. Pass --theme catppuccin-latte or --theme catppuccin-mocha.',
    );
  const host = await sandbox(args.positionals[0] ?? 'live', theme);
  try {
    const envArgs = Object.entries(host.env).map(
      ([key, value]) => `${key}=${value}`,
    );
    const child = Bun.spawn(
      [
        terminalBinary,
        'run',
        args.values.name,
        '--host',
        'opentui',
        '--cols',
        '120',
        '--rows',
        '40',
        '--cwd',
        host.directory,
        '--',
        '/usr/bin/env',
        '-i',
        ...envArgs,
        ...host.command,
      ],
      {stdin: 'inherit', stdout: 'inherit', stderr: 'inherit'},
    );
    process.exitCode = await child.exited;
  } finally {
    await host.cleanup();
  }
});
