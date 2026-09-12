import {appendFile, mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

const [directory, role] = process.argv.slice(2);
if (!directory || !role)
  throw new Error('fixture-worker requires directory and role');
await mkdir(directory, {recursive: true});
const releasePath = join(directory, `${role}.release`);
const progressPath = join(directory, `${role}.progress`);
await writeFile(join(directory, `${role}.pid`), `${process.pid}\n`);
let counter = 0;
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  if (existsSync(releasePath)) break;
  counter++;
  const progress = `${Date.now()} ${role} ${counter}\n`;
  await appendFile(progressPath, progress);
  process.stdout.write(progress);
  await Bun.sleep(100);
}
await appendFile(progressPath, `${Date.now()} ${role} released\n`);
process.stdout.write(`${Date.now()} ${role} released\n`);
process.exit(role === 'tester' ? 1 : 0);
