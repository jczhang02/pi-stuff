import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

const REPOSITORY_ROOT = resolve(import.meta.dir, "..");
const TODO_EXTENSION = join(REPOSITORY_ROOT, "packages", "pi-stuff-todo", "index.ts");
const TODO_PACKAGE = resolve(TODO_EXTENSION, "..");
const BTW_PACKAGE = join(REPOSITORY_ROOT, "packages", "pi-stuff-btw");
const UI_PACKAGE = join(REPOSITORY_ROOT, "packages", "pi-stuff-ui");
const AGGREGATE_EXTENSION = join(REPOSITORY_ROOT, "packages", "pi-stuff", "index.ts");
const EXPECTED_TOOLS = ["TaskCreate", "TaskGet", "TaskList", "TaskUpdate"];

const sessions: AgentSession[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
	for (const session of sessions.splice(0)) {
		session.dispose();
	}
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type ExtensionPath = string | ((temporaryRoot: string) => Promise<string>);

async function loadExtension(extensionPath: ExtensionPath): Promise<AgentSession> {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-todo-host-"));
	temporaryRoots.push(root);
	const agentDir = join(root, "agent");
	await mkdir(agentDir);
	const resolvedExtensionPath = typeof extensionPath === "string" ? extensionPath : await extensionPath(root);

	const resourceLoader = new DefaultResourceLoader({
		cwd: root,
		agentDir,
		additionalExtensionPaths: [resolvedExtensionPath],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();

	const { session, extensionsResult } = await createAgentSession({
		cwd: root,
		agentDir,
		resourceLoader,
		sessionManager: SessionManager.inMemory(root),
		noTools: "builtin",
	});
	sessions.push(session);

	expect(extensionsResult.errors).toEqual([]);
	expect(extensionsResult.extensions).toHaveLength(1);
	await session.bindExtensions({});
	return session;
}

test("Pi 0.83 loads exactly the Todo tools from the Capability package", async () => {
	const session = await loadExtension(TODO_EXTENSION);

	expect([...session.getActiveToolNames()].sort()).toEqual(EXPECTED_TOOLS);
});

test("Pi 0.83 loads exactly the Todo tools through the Aggregate package", async () => {
	const session = await loadExtension(async (root) => {
		const aggregateDirectory = join(root, "aggregate");
		const dependencyScope = join(aggregateDirectory, "node_modules", "@jczhang02");
		await mkdir(aggregateDirectory);
		await mkdir(dependencyScope, { recursive: true });
		await writeFile(join(aggregateDirectory, "index.ts"), await readFile(AGGREGATE_EXTENSION));
		await Promise.all([
			symlink(UI_PACKAGE, join(dependencyScope, "pi-stuff-ui"), "dir"),
			symlink(TODO_PACKAGE, join(dependencyScope, "pi-stuff-todo"), "dir"),
			symlink(BTW_PACKAGE, join(dependencyScope, "pi-stuff-btw"), "dir"),
		]);
		return join(aggregateDirectory, "index.ts");
	});

	expect([...session.getActiveToolNames()].sort()).toEqual(EXPECTED_TOOLS);
});
