import {Effect} from 'effect';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {launchPi} from '../../tests/system/fixtures/pi-terminal';

await Effect.runPromise(
  Effect.tryPromise({
    try: async () => {
      const results: {
        rules: number;
        size: number;
        round: number;
        textMs: number[];
        colorMs: number[];
        observationMs: number[];
      }[] = [];
      for (let round = 0; round < 3; round++) {
        for (const rules of round % 2 ? [100, 10] : [10, 100]) {
          const host = await launchPi(
            JSON.stringify({
              editor: {
                keywords: Array.from({length: rules}, (_, i) => ({
                  pattern: i === 0 ? 'review' : `sample${i}|plain${i}`,
                })),
              },
            }),
            resolve('tools/performance/fixtures.ts'),
          );
          try {
            for (const size of [256, 4096, 32768, 131072]) {
              await host.command(`/perf-draft ${size}`);
              await host.terminal.screen.waitForText('END_TAG', {
                timeoutMs: 5000,
              });
              const textMs: number[] = [];
              const colorMs: number[] = [];
              const observationMs: number[] = [];
              for (let i = 0; i < 10; i++) {
                const start = performance.now();
                await host.terminal.screen.waitUntil(() => true, {
                  timeoutMs: 5000,
                });
                observationMs.push(performance.now() - start);
              }
              for (let i = 0; i < 20; i++) {
                const start = performance.now();
                await host.terminal.keyboard.type(' Review');
                await host.terminal.screen.waitForText('END_TAG Review', {
                  timeoutMs: 5000,
                });
                textMs.push(performance.now() - start);
                await host.terminal.screen.waitUntil(
                  shot =>
                    shot.frame.cells.some(
                      cell =>
                        cell.text === 'R' &&
                        cell.attributes.bold &&
                        cell.foreground.r === 63 &&
                        cell.foreground.g === 81 &&
                        cell.foreground.b === 177 &&
                        shot.frame.cells.some(
                          before =>
                            before.y === cell.y &&
                            before.x === cell.x - 2 &&
                            before.text === 'G',
                        ),
                    ),
                  {timeoutMs: 5000},
                );
                colorMs.push(performance.now() - start);
                await host.terminal.keyboard.sequence(
                  Array.from({length: 7}, () => 'Backspace' as const),
                );
                await host.terminal.screen.waitUntil(
                  shot => !shot.text.includes('END_TAG Review'),
                  {timeoutMs: 5000},
                );
              }
              results.push({
                rules,
                size,
                round,
                textMs,
                colorMs,
                observationMs,
              });
              console.log(JSON.stringify(results.at(-1)));
              await writeFile(
                process.env.PI_PERF_OUTPUT ?? '/tmp/pi-color-perf-results.json',
                JSON.stringify(results, null, 2),
              );
              await host.terminal.keyboard.press('Control+C');
              await host.terminal.screen.waitUntil(
                shot => !shot.text.includes('END_TAG'),
                {timeoutMs: 5000},
              );
            }
          } finally {
            await host.close();
          }
        }
      }
    },
    catch: cause => new Error('Terminal color measurement failed', {cause}),
  }),
);
