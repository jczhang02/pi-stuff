import {Effect} from 'effect';
import {resolve} from 'node:path';
import {launchPi} from '../../tests/system/fixtures/pi-terminal';
import {readFile, writeFile} from 'node:fs/promises';

await Effect.runPromise(
  Effect.tryPromise({
    try: async () => {
      const baseline = process.env.PI_PERF_BASELINE;
      if (!baseline)
        throw new Error(
          'Set PI_PERF_BASELINE to the extracted 1369773 package',
        );
      const current = process.cwd();
      const results: {
        name: string;
        size: number;
        round: number;
        firstEditMs: number;
        samples: number[];
        rssKb: number;
        idleCpuMs: number;
      }[] = [];
      const configs = [
        {name: 'baseline', path: baseline, config: {}},
        {name: 'disabled', path: current, config: {editor: {enabled: false}}},
        {name: 'skills', path: current, config: {editor: {enabled: true}}},
        {
          name: 'regex10',
          path: current,
          config: {
            editor: {
              keywords: Array.from({length: 10}, (_, i) => ({
                pattern: i === 0 ? 'review' : `sample${i}|plain${i}`,
              })),
            },
          },
        },
        {
          name: 'regex100',
          path: current,
          config: {
            editor: {
              keywords: Array.from({length: 100}, (_, i) => ({
                pattern: i === 0 ? 'review' : `sample${i}|plain${i}`,
              })),
            },
          },
        },
      ];
      const stress = process.argv.includes('--stress');
      for (let round = 0; round < (stress ? 2 : 3); round++) {
        for (const item of round % 2 ? configs.toReversed() : configs) {
          process.env.PI_TEST_PACKAGE = item.path;
          const host = await launchPi(
            JSON.stringify(item.config),
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
            if (!pid) throw new Error('missing PID');
            const cpu = async () => {
              const stat = (await readFile(`/proc/${pid}/stat`, 'utf8')).split(
                ' ',
              );
              return (Number(stat[13]) + Number(stat[14])) * 10;
            };
            for (const size of stress ? [131072] : [256, 4096, 32768]) {
              await host.command(`/perf-draft ${size}`);
              await host.terminal.screen.waitForText('END_TAG', {
                timeoutMs: 5000,
              });
              const samples: number[] = [];
              for (let i = 0; i < 31; i++) {
                const start = performance.now();
                await host.terminal.keyboard.type('x');
                await host.terminal.screen.waitForText('END_TAGx', {
                  timeoutMs: 5000,
                });
                samples.push(performance.now() - start);
                await host.terminal.keyboard.press('Backspace');
                await host.terminal.screen.waitUntil(
                  shot =>
                    shot.text.includes('END_TAG') &&
                    !shot.text.includes('END_TAGx'),
                  {timeoutMs: 5000},
                );
              }
              const before = await cpu();
              await Bun.sleep(500);
              const idleCpuMs = (await cpu()) - before;
              const rssKb = Number(
                (await readFile(`/proc/${pid}/status`, 'utf8')).match(
                  /VmRSS:\s+(\d+)/u,
                )?.[1],
              );
              const firstEditMs = samples.shift() ?? 0;
              results.push({
                name: item.name,
                size,
                round,
                firstEditMs,
                samples,
                rssKb,
                idleCpuMs,
              });
              console.log(
                JSON.stringify({
                  name: item.name,
                  size,
                  round,
                  firstEditMs,
                  p95: samples.toSorted((a, b) => a - b)[28],
                  rssKb,
                  idleCpuMs,
                }),
              );
              await writeFile(
                process.env.PI_PERF_OUTPUT ??
                  (stress
                    ? '/tmp/pi-input-stress-results.json'
                    : '/tmp/pi-input-perf-results.json'),
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
    catch: cause =>
      new Error('Terminal performance measurement failed', {cause}),
  }),
);
