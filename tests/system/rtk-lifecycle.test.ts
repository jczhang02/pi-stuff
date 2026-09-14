import {expect, test} from 'bun:test';
import {
  access,
  constants,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RtkRuntime} from '../../src/rtk/runtime';
import {launchPi} from './fixtures/pi-terminal';

async function waitForFile(path: string, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path, constants.F_OK);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

test('Pi passes one rewrite argv and skips a second rewrite for RTK', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk');
    const rewriteArity = join(host.directory, 'rewrite-arity');
    const rewriteCalls = join(host.directory, 'rewrite-calls');
    const rewriteInput = join(host.directory, 'rewrite-input');
    const fixtureCalls = join(host.directory, 'fixture-calls');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0';;
  rewrite)
    count=$(cat ${shellQuote(rewriteCalls)} 2>/dev/null || printf '0')
    count=$((count + 1))
    printf '%s' "$count" > ${shellQuote(rewriteCalls)}
    printf '%s' "$#" > ${shellQuote(rewriteArity)}
    printf '%s' "$2" > ${shellQuote(rewriteInput)}
    printf 'rtk fixture';;
  fixture)
    count=$(cat ${shellQuote(fixtureCalls)} 2>/dev/null || printf '0')
    count=$((count + 1))
    printf '%s' "$count" > ${shellQuote(fixtureCalls)}
    printf 'DIRECT_OK\\n';;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {executable}}),
    );
    await host.reload();

    const original = `printf '%s' "literal rtk | > 'quoted'" | cat > 'ignored output'`;
    expect(await host.invoke('bash', JSON.stringify({command: original}))).toBe(
      'DIRECT_OK\n',
    );
    expect(await readFile(rewriteArity, 'utf8')).toBe('2');
    expect(await readFile(rewriteInput, 'utf8')).toBe(original);
    expect(await readFile(rewriteCalls, 'utf8')).toBe('1');
    expect(await readFile(fixtureCalls, 'utf8')).toBe('1');

    const alreadyBound = `${shellQuote(executable)} fixture`;
    expect(
      await host.invoke('bash', JSON.stringify({command: alreadyBound})),
    ).toBe('DIRECT_OK\n');
    expect(await readFile(rewriteCalls, 'utf8')).toBe('1');
    expect(await readFile(fixtureCalls, 'utf8')).toBe('2');
  } finally {
    await host.close();
  }
}, 30000);

test('Pi still cleans ANSI when rewrite is disabled without invoking RTK', async () => {
  const host = await launchPi();
  try {
    const executable = join(host.directory, 'rtk-disabled');
    const marker = join(host.directory, 'rtk-invoked');
    await writeFile(marker, 'not-called');
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s' "$1" > ${shellQuote(marker)}
exit 0
`,
      {mode: 0o700},
    );
    await writeFile(
      join(host.agent, 'pi-stuff.json'),
      JSON.stringify({rtk: {rewrite: false, executable}}),
    );
    await host.reload();

    expect(
      await host.invoke(
        'bash',
        JSON.stringify({
          command: "printf '\\033[31mNO_REWRITE 中文\\033[0m\\n'",
        }),
      ),
    ).toBe('NO_REWRITE 中文\n');
    expect(await readFile(marker, 'utf8')).toBe('not-called');
  } finally {
    await host.close();
  }
}, 30000);

test('RtkRuntime keeps mise resolution cached independently for each cwd', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-stuff-rtk-lifecycle-'));
  const originalPath = process.env.PATH;
  try {
    const bin = join(directory, 'bin');
    const firstCwd = join(directory, 'first');
    const secondCwd = join(directory, 'second');
    const firstRtk = join(firstCwd, 'rtk-first');
    const secondRtk = join(secondCwd, 'rtk-second');
    const mise = join(bin, 'mise');
    const miseCalls = join(directory, 'mise-calls');
    await mkdir(bin);
    await mkdir(firstCwd);
    await mkdir(secondCwd);
    await writeFile(
      firstRtk,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0';;
  fixture) printf 'FIRST\\n';;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      secondRtk,
      `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.45.0';;
  fixture) printf 'SECOND\\n';;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );
    await writeFile(
      mise,
      `#!/bin/sh
if [ "$1" != 'which' ] || [ "$2" != 'rtk' ]; then exit 2; fi
cwd=$(pwd -P)
printf '%s\\n' "$cwd" >> ${shellQuote(miseCalls)}
case "$cwd" in
  ${shellQuote(firstCwd)}) printf '%s\\n' ${shellQuote(firstRtk)};;
  ${shellQuote(secondCwd)}) printf '%s\\n' ${shellQuote(secondRtk)};;
  *) exit 3;;
esac
`,
      {mode: 0o700},
    );
    process.env.PATH = `${bin}:/usr/bin:/bin`;

    const runtime = new RtkRuntime();
    const first = await runtime.probe(firstCwd);
    const second = await runtime.probe(secondCwd);
    const firstAgain = await runtime.probe(firstCwd);
    expect(first).toEqual({
      path: firstRtk,
      version: '0.45.0',
      source: 'mise',
    });
    expect(second).toEqual({
      path: secondRtk,
      version: '0.45.0',
      source: 'mise',
    });
    expect(firstAgain).toEqual(first);
    expect((await runtime.execute(['fixture'], firstCwd)).stdout).toBe(
      'FIRST\n',
    );
    expect((await runtime.execute(['fixture'], secondCwd)).stdout).toBe(
      'SECOND\n',
    );
    expect(await readFile(miseCalls, 'utf8')).toBe(
      `${firstCwd}\n${secondCwd}\n`,
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(directory, {recursive: true, force: true});
  }
}, 30000);

test('RtkRuntime does not cache a probe that finishes after invalidation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-stuff-rtk-invalidation-'));
  try {
    const executable = join(directory, 'rtk');
    const started = join(directory, 'version-started');
    const calls = join(directory, 'version-calls');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version)
    count=$(cat ${shellQuote(calls)} 2>/dev/null || printf '0')
    count=$((count + 1))
    printf '%s' "$count" > ${shellQuote(calls)}
    if [ "$count" = '1' ]; then
      : > ${shellQuote(started)}
      sleep 0.2
      printf 'rtk 0.45.0'
    else
      printf 'rtk 0.46.0'
    fi;;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );

    const runtime = new RtkRuntime({executable});
    const pending = runtime.probe(directory);
    await waitForFile(started);
    runtime.invalidate();
    expect(await pending).toEqual({
      path: executable,
      version: '0.45.0',
      source: 'custom',
    });

    expect(await runtime.probe(directory)).toEqual({
      path: executable,
      version: '0.46.0',
      source: 'custom',
    });
    expect(await readFile(calls, 'utf8')).toBe('2');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}, 30000);

test('RtkRuntime does not cache a failed probe that finishes after invalidation', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'pi-stuff-rtk-failure-invalidation-'),
  );
  try {
    const executable = join(directory, 'rtk');
    const started = join(directory, 'version-started');
    const calls = join(directory, 'version-calls');
    await writeFile(
      executable,
      `#!/bin/sh
case "$1" in
  --version)
    count=$(cat ${shellQuote(calls)} 2>/dev/null || printf '0')
    count=$((count + 1))
    printf '%s' "$count" > ${shellQuote(calls)}
    if [ "$count" = '1' ]; then
      : > ${shellQuote(started)}
      sleep 0.2
      printf 'not-an-rtk-version'
    else
      printf 'rtk 0.47.0'
    fi;;
  *) exit 2;;
esac
`,
      {mode: 0o700},
    );

    const runtime = new RtkRuntime({executable});
    const pending = runtime.probe(directory);
    await waitForFile(started);
    runtime.invalidate();
    await expect(pending).rejects.toMatchObject({kind: 'invalid'});

    expect(await runtime.probe(directory)).toEqual({
      path: executable,
      version: '0.47.0',
      source: 'custom',
    });
    expect(await readFile(calls, 'utf8')).toBe('2');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}, 30000);
