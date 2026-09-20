// One-command shared foreground prototype. Ctrl+D exits and deletes scratch state.
import {parseArgs} from 'node:util';
import {sandbox, terminalBinary, runEffect} from './launch';
const args = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    theme: {type: 'string', default: 'catppuccin-mocha'},
    name: {type: 'string', default: 'pi-ui-session'},
  },
});
const theme = args.values.theme;
if (theme !== 'catppuccin-mocha' && theme !== 'catppuccin-latte')
  throw new Error('Select catppuccin-mocha or catppuccin-latte');
await runEffect(async () => {
  const host = await sandbox(args.positionals[0] ?? 'session', theme);
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
