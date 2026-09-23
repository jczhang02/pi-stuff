import {Effect} from 'effect';
import {resolve} from 'node:path';
import {launchPi} from '../../tests/system/fixtures/pi-terminal';
import {readFile, writeFile} from 'node:fs/promises';

await Effect.runPromise(
  Effect.tryPromise({
    try: async () => {
      const results = [];
      for (let round = 0; round < 3; round++) {
        const host = await launchPi(
          JSON.stringify({editor: {keywords: [{pattern: '(a+)+$'}]}}),
          resolve('tools/performance/fixtures.ts'),
        );
        try {
          await host.command('/perf-pid');
          await host.terminal.screen.waitForText('PERF_PID_', {
            timeoutMs: 5000,
          });
          const pid = (await host.terminal.screen.text()).match(
            /PERF_PID_(\d+)/u,
          )?.[1];
          if (!pid) throw new Error('missing process');
          const cpu = async () => {
            const v = (await readFile(`/proc/${pid}/stat`, 'utf8')).split(' ');
            return (Number(v[13]) + Number(v[14])) * 10;
          };
          await host.command('/perf-evil');
          await host.terminal.screen.waitForText('END_TAG', {timeoutMs: 5000});
          const before = await cpu();
          const burstStart = performance.now();
          const samples = [];
          for (let i = 0; i < 30; i++) {
            const start = performance.now();
            await host.terminal.keyboard.type('x');
            await host.terminal.screen.waitForText('END_TAGx', {
              timeoutMs: 3000,
            });
            samples.push(performance.now() - start);
            await host.terminal.keyboard.press('Backspace');
            await host.terminal.screen.waitUntil(
              s => !s.text.includes('END_TAGx'),
              {timeoutMs: 3000},
            );
          }
          await Bun.sleep(1000);
          const after = await cpu();
          const burstWallMs = performance.now() - burstStart;
          await Bun.sleep(1000);
          const idleCpuMs = (await cpu()) - after;
          const settledStart = await cpu();
          await Bun.sleep(2000);
          const settledCpuMs = (await cpu()) - settledStart;
          results.push({
            round,
            samples,
            burstCpuMs: after - before,
            burstWallMs,
            idleCpuMs,
            settledCpuMs,
          });
          console.log(JSON.stringify(results.at(-1)));
        } finally {
          await host.close();
        }
      }
      await writeFile(
        process.env.PI_PERF_OUTPUT ?? '/tmp/pi-evil-perf-results.json',
        JSON.stringify(results, null, 2),
      );
    },
    catch: cause =>
      new Error('Terminal performance measurement failed', {cause}),
  }),
);
