import {expect, test} from 'bun:test';
import {
  createAgentSession,
  DefaultResourceLoader,
  initTheme,
  ModelRuntime,
  SessionManager,
  type ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mainFooter} from '../../src/subagent/main-footer';

const usageEntry = {
  type: 'usage',
  id: 'usage-entry',
  parentId: null,
  timestamp: '2026-01-01T00:00:01.000Z',
  kind: 'cache_warm',
  provider: 'fixture',
  model: 'fixture',
  usage: {
    input: 1000,
    output: 50,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 1050,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0.25,
    },
  },
} as const;

test('counts a native usage entry once in the footer totals', async () => {
  initTheme('dark', false);
  const directory = await mkdtemp(join(tmpdir(), 'pi-main-footer-'));
  const agentDir = join(directory, 'agent');
  const sessionDir = join(directory, 'sessions');
  const sessionFile = join(sessionDir, 'usage-session.jsonl');
  await mkdir(agentDir);
  await mkdir(sessionDir);
  await writeFile(
    sessionFile,
    `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'usage-session',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: directory,
    })}\n${JSON.stringify(usageEntry)}\n`,
  );

  let session:
    | Awaited<ReturnType<typeof createAgentSession>>['session']
    | undefined;
  try {
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const created = await createAgentSession({
      cwd: directory,
      agentDir,
      modelRuntime,
      resourceLoader,
      sessionManager: SessionManager.open(sessionFile, sessionDir, directory),
      tools: [],
    });
    session = created.session;
    await session.bindExtensions({mode: 'json'});
    const context = session.extensionRunner.createContext();
    const footerData: ReadonlyFooterDataProvider = {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map<string, string>(),
      getAvailableProviderCount: () => 0,
      onBranchChange: () => () => {},
    };

    const lines = mainFooter(context, footerData, context.ui.theme, 120);
    const footer = lines.join('\n');
    expect(JSON.stringify(context.sessionManager.getEntries())).toContain(
      '"kind":"cache_warm"',
    );
    expect(footer).toContain('↑1k');
    expect(footer).toContain('↓50');
    expect(footer).toContain('$0.250');
  } finally {
    session?.dispose();
    await rm(directory, {recursive: true, force: true});
  }
});
