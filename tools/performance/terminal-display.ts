import {Effect} from 'effect';
import {resolve} from 'node:path';
import {launchPi} from '../../tests/system/fixtures/pi-terminal';
import {writeFile} from 'node:fs/promises';

await Effect.runPromise(
  Effect.tryPromise({
    try: async () => {
      const baseline = process.env.PI_PERF_BASELINE;
      if (!baseline)
        throw new Error(
          'Set PI_PERF_BASELINE to the extracted comparison package',
        );
      const results: {
        name: string;
        kind: string;
        round: number;
        samples: number[];
        expansions: number[];
      }[] = [];
      for (let round = 0; round < 3; round++) {
        for (const name of round % 2
          ? ['current', 'baseline']
          : ['baseline', 'current']) {
          process.env.PI_TEST_PACKAGE =
            name === 'baseline' ? baseline : process.cwd();
          const host = await launchPi(
            '{}',
            resolve('tools/performance/fixtures.ts'),
          );
          try {
            for (const kind of ['plain', 'tree', 'chart', 'skill']) {
              const samples: number[] = [];
              const expansions: number[] = [];
              for (let i = 0; i < 10; i++) {
                const id = `${kind}_${round}_${i}`;
                await host.terminal.keyboard.type(
                  `/perf-message ${kind} ${id}`,
                );
                const start = performance.now();
                await host.terminal.keyboard.press('Enter');
                await host.terminal.screen.waitForText(`BODY_END_${id}`, {
                  timeoutMs: 15000,
                });
                samples.push(performance.now() - start);
                await host.terminal.screen.waitForText('RTK_TURN_0_DONE', {
                  timeoutMs: 15000,
                });
                if (kind === 'skill') {
                  const expandStart = performance.now();
                  await host.terminal.keyboard.press('Control+O');
                  await host.terminal.screen.waitForText('INSTRUCTIONS_END', {
                    timeoutMs: 10000,
                  });
                  expansions.push(performance.now() - expandStart);
                  await host.terminal.keyboard.press('Control+O');
                }
                await host.command('/new');
                await host.terminal.screen.waitUntil(
                  shot => !shot.text.includes(`BODY_END_${id}`),
                  {timeoutMs: 5000},
                );
              }
              results.push({name, kind, round, samples, expansions});
              console.log(
                JSON.stringify({name, kind, round, samples, expansions}),
              );
              await writeFile(
                process.env.PI_PERF_OUTPUT ??
                  '/tmp/pi-display-perf-results.json',
                JSON.stringify(results, null, 2),
              );
            }
          } finally {
            await host.close();
          }
        }
      }
    },
    catch: cause =>
      new Error('Terminal performance measurement failed', {cause}),
  }),
);
