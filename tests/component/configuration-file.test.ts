import {expect, test} from 'bun:test';
import {watch, writeFileSync} from 'node:fs';
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

test('RTK rejects an external edit made while its replacement is staged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-configuration-'));
  const path = join(directory, 'pi-stuff.json');
  try {
    await writeFile(path, '{}');
    const file = await Effect.runPromise(ConfigurationFile.load(path));
    const external = '{"tools":{"web_search":false}}';
    let edited = false;
    const writer = watch(directory, (_event, filename) => {
      if (!edited && filename?.endsWith('.tmp')) {
        edited = true;
        writeFileSync(path, external);
      }
    });
    try {
      await expect(
        Effect.runPromise(file.saveRtk({ansi: false})),
      ).rejects.toThrow('Settings changed on disk');
      expect(edited).toBe(true);
      expect(await readFile(path, 'utf8')).toBe(external);
      expect(file.value.rtk).toBeUndefined();
      expect(await readdir(directory)).toEqual(['pi-stuff.json']);
    } finally {
      writer.close();
    }
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

test('naming and RTK share one configuration revision through an existing symlink', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-naming-config-'));
  const path = join(directory, 'pi-stuff.json');
  const target = join(directory, 'managed.json');
  try {
    await writeFile(target, '{"tools":{"web_search":false}}');
    await symlink(target, path);
    const owner = await Effect.runPromise(ConfigurationFile.load(path));
    const stale = await Effect.runPromise(ConfigurationFile.load(path));
    await Effect.runPromise(
      owner.saveNaming({automatic: false, prompt: 'Keep the core task.'}),
    );
    await Effect.runPromise(owner.saveRtk({ansi: false}));
    expect(await readlink(path)).toBe(target);
    expect(owner.value).toEqual({
      tools: {web_search: false},
      rtk: {ansi: false},
      naming: {automatic: false, prompt: 'Keep the core task.'},
    });
    await expect(Effect.runPromise(stale.saveNaming({}))).rejects.toThrow(
      'Settings changed on disk',
    );
    expect(stale.value.naming).toBeUndefined();
    expect((await readdir(directory)).toSorted()).toEqual([
      'managed.json',
      'pi-stuff.json',
    ]);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
