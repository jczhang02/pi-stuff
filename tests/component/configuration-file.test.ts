import {expect, test} from 'bun:test';
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  readdir,
  symlink,
  readlink,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {ConfigurationFile} from '../../src/pi/configuration-file';

test('RTK saves preserve unrelated settings and reject stale writers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-configuration-'));
  const path = join(directory, 'pi-stuff.json');
  try {
    const original = {tools: {web_search: false}, web: {}};
    await writeFile(path, JSON.stringify(original));
    const first = await Effect.runPromise(ConfigurationFile.load(path));
    const second = await Effect.runPromise(ConfigurationFile.load(path));
    await Effect.runPromise(first.saveRtk({ansi: false}));
    expect(await readFile(path, 'utf8')).toBe(
      `${JSON.stringify({...original, rtk: {ansi: false}}, null, 2)}\n`,
    );
    await expect(
      Effect.runPromise(second.saveRtk({rewrite: false})),
    ).rejects.toThrow('Settings changed on disk');
    expect(second.value.rtk).toBeUndefined();
    expect(await readdir(directory)).toEqual(['pi-stuff.json']);
    await Effect.runPromise(first.saveRtk({rewrite: false, ansi: false}));
    expect(first.value.rtk).toEqual({rewrite: false, ansi: false});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('RTK concurrent-save lock leaves disk and active settings unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-configuration-'));
  const path = join(directory, 'pi-stuff.json');
  try {
    await writeFile(path, '{}');
    const file = await Effect.runPromise(ConfigurationFile.load(path));
    await writeFile(`${path}.lock`, 'another owner');
    await expect(
      Effect.runPromise(file.saveRtk({ansi: false})),
    ).rejects.toThrow('Could not finish saving');
    expect(await readFile(path, 'utf8')).toBe('{}');
    expect(await readFile(`${path}.lock`, 'utf8')).toBe('another owner');
    expect(file.value.rtk).toBeUndefined();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('RTK saves retain an existing configuration symlink', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-configuration-'));
  const path = join(directory, 'pi-stuff.json');
  const target = join(directory, 'managed.json');
  try {
    await writeFile(target, '{}');
    await symlink(target, path);
    const file = await Effect.runPromise(ConfigurationFile.load(path));
    await Effect.runPromise(file.saveRtk({ansi: false}));
    expect(await readlink(path)).toBe(target);
    expect(await readFile(target, 'utf8')).toContain('"ansi": false');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
