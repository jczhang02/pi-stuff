import {appendFile, mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

const [directory, role] = process.argv.slice(2);
if (!directory || !role)
  throw new Error('subagent fixture worker requires directory and role');

await mkdir(directory, {recursive: true});
const release = join(directory, `${role}.release`);
const progress = join(directory, `${role}.progress`);
await writeFile(join(directory, `${role}.pid`), `${process.pid}\n`);
let tick = 0;
const deadline = Date.now() + 90_000;
while (Date.now() < deadline && !existsSync(release)) {
  tick++;
  const line = `${Date.now()} ${role} ${tick}\n`;
  await appendFile(progress, line);
  process.stdout.write(line);
  await Bun.sleep(80);
}
await appendFile(progress, `${Date.now()} ${role} released\n`);
process.stdout.write(`${Date.now()} ${role} released\n`);
process.exit(role === 'tester' ? 1 : 0);
