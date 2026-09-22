// Launch under `bun run tui run statusline -- bun prototypes/statusline/run.ts`.
import {parseArgs} from 'node:util';
import {Schema} from 'effect';
import {createHost, runEffect} from './host';

const {values} = parseArgs({
  options: {
    theme: {type: 'string', default: 'catppuccin-latte'},
    scenario: {type: 'string', default: 'extended'},
  },
});
const options = Schema.decodeUnknownSync(
  Schema.Struct({
    theme: Schema.Literals(['catppuccin-latte', 'catppuccin-mocha']),
    scenario: Schema.Literals(['base', 'extended', 'long']),
  }),
)(values);

await runEffect(async () => {
  const host = await createHost(options.scenario, options.theme);
  try {
    const child = Bun.spawn(host.command, {
      cwd: host.directory,
      env: host.env,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const terminate = () => child.kill('SIGTERM');
    process.once('SIGINT', terminate);
    process.once('SIGTERM', terminate);
    try {
      process.exitCode = await child.exited;
    } finally {
      process.removeListener('SIGINT', terminate);
      process.removeListener('SIGTERM', terminate);
    }
  } finally {
    await host.cleanup();
  }
});
