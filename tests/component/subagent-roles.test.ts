import {expect, test} from 'bun:test';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {Effect} from 'effect';
import {resolveRole} from '../../src/subagent/roles';

async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pi-roles-'));
}

async function writeRole(
  path: string,
  frontmatter: string,
  body: string,
): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, `---\n${frontmatter}\n---\n${body}`);
}

test('resolveRole returns the highest-scoring project role', async () => {
  const root = await temporaryRoot();
  try {
    const cwd = join(root, 'project', 'src');
    const agentDir = join(root, 'user', '.pi');
    const preferred = join(root, 'project', '.agents', 'agents', 'review.md');
    const weaker = join(root, 'project', '.pi', 'agents', 'review.md');
    await writeRole(
      preferred,
      'description: Review code changes with tests\nmodel: review-model',
      'preferred body',
    );
    await writeRole(weaker, 'description: Review code', 'weaker body');

    const role = await Effect.runPromise(
      resolveRole('reviewer', 'Review code changes with tests', cwd, agentDir),
    );

    expect(role).toMatchObject({
      path: preferred,
      body: 'preferred body',
      model: 'review-model',
      description: 'Review code changes with tests',
    });
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('resolveRole keeps the first match across directory precedence ties', async () => {
  const root = await temporaryRoot();
  try {
    const cwd = join(root, 'project', 'src');
    const agentDir = join(root, 'user', '.pi');
    const agentsRole = join(root, 'project', '.agents', 'agents', 'a.md');
    const claudeRole = join(root, 'project', '.claude', 'agents', 'b.md');
    await writeRole(agentsRole, 'description: Inspect code tests', 'agents');
    await writeRole(claudeRole, 'description: Inspect code tests', 'claude');

    const role = await Effect.runPromise(
      resolveRole('investigator', 'Inspect code tests', cwd, agentDir),
    );

    expect(role?.path).toBe(agentsRole);
    expect(role?.body).toBe('agents');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('resolveRole searches the home derived from agentDir', async () => {
  const root = await temporaryRoot();
  try {
    const cwd = join(root, 'project', 'src');
    const home = join(root, 'user');
    const agentDir = join(home, '.config', '.pi');
    const homeRole = join(home, '.pi', 'agents', 'research.md');
    await writeRole(
      homeRole,
      'description: Research repository history',
      'home',
    );

    const role = await Effect.runPromise(
      resolveRole('researcher', 'Research repository history', cwd, agentDir),
    );

    expect(role?.path).toBe(homeRole);
    expect(role?.body).toBe('home');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('resolveRole parses string and array tools from frontmatter', async () => {
  const root = await temporaryRoot();
  try {
    const cwd = join(root, 'project');
    const agentDir = join(root, 'user', '.pi');
    const stringRole = join(root, '.agents', 'agents', 'reader.md');
    const arrayRole = join(root, '.agents', 'agents', 'writer.md');
    await writeRole(
      stringRole,
      'description: Read source files\ntools: read, grep',
      'reader',
    );
    await writeRole(
      arrayRole,
      'description: Edit source files\ntools:\n  - read\n  - edit',
      'writer',
    );

    const reader = await Effect.runPromise(
      resolveRole('reader', 'Read source files', cwd, agentDir),
    );
    const writer = await Effect.runPromise(
      resolveRole('writer', 'Edit source files', cwd, agentDir),
    );

    expect(reader?.tools).toEqual(['read', 'grep']);
    expect(writer?.tools).toEqual(['read', 'edit']);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('resolveRole truncates a long role body at 64,000 characters', async () => {
  const root = await temporaryRoot();
  try {
    const cwd = join(root, 'project');
    const agentDir = join(root, 'user', '.pi');
    const path = join(root, '.agents', 'agents', 'long.md');
    const body = 'x'.repeat(64_001);
    await writeRole(path, 'description: Inspect large reports', body);

    const role = await Effect.runPromise(
      resolveRole('reviewer', 'Inspect large reports', cwd, agentDir),
    );

    expect(role?.body.startsWith('x'.repeat(64_000))).toBe(true);
    expect(role?.body).toContain('[truncated: agent file exceeded 64000 chars');
    expect(role?.body).toBe(
      `${body.slice(0, 64_000)}\n\n[truncated: agent file exceeded 64000 chars — slim it down]`,
    );
    expect(await readFile(path, 'utf8')).toContain(body);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
