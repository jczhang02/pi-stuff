// Throwaway real-runtime launcher. Only the model HTTP boundary is controlled.
import {join} from 'node:path';
import {Schema} from 'effect';
import {createFixture} from './fixture';
import {isolatedEnvironment} from './environment';

const theme = Schema.decodeUnknownSync(Schema.Literals(['light', 'dark']))(
  process.argv.find(value => value.startsWith('--theme='))?.slice(8) ?? 'light',
);
const fixture = await createFixture();
try {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, 'host.ts')],
    {
      cwd: fixture.cwd,
      env: {
        ...isolatedEnvironment(fixture.directory, fixture.agentDir),
        PI_RUNTIME_THEME: theme,
      },
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  process.exitCode = await child.exited;
} finally {
  await fixture.close();
}
