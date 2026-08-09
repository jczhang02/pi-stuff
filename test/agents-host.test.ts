import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildPiArgs, PI_STUFF_AGENT_PATH_ENV } from "../packages/pi-stuff-agents/src/runs/shared/pi-args.ts";
import { runPiRpcSmoke } from "../scripts/smoke-pi.ts";

const { PI_BIN: PI_BINARY = "/opt/pi-coding-agent/pi" } = process.env;
const AGENTS_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff-agents");
const CONTEXT_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff-context");
const TOOLS_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff-tools");
const UI_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff-ui");
const WORK_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff-work");
const TYPEBOX_PACKAGE = resolve(import.meta.dir, "../node_modules/typebox");
const TEMPORARY_ROOTS: string[] = [];

afterEach(async () => {
	await Promise.all(TEMPORARY_ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Agents gives same-name sibling processes stable unique path components", () => {
	const previousAgentPath = process.env[PI_STUFF_AGENT_PATH_ENV];
	process.env[PI_STUFF_AGENT_PATH_ENV] = "root-run:0";
	const buildChildPath = (runId?: string, childIndex?: number): string | undefined =>
		buildPiArgs({
			baseArgs: [],
			task: "path identity test",
			sessionEnabled: false,
			inheritProjectContext: true,
			inheritSkills: true,
			childAgentName: "general",
			...(runId ? { runId } : {}),
			...(childIndex !== undefined ? { childIndex } : {}),
		}).env[PI_STUFF_AGENT_PATH_ENV];

	try {
		expect(buildChildPath("parallel-run", 1)).toBe("root-run:0 › parallel-run:1");
		expect(buildChildPath("parallel-run", 2)).toBe("root-run:0 › parallel-run:2");
		expect(buildChildPath()).toBe("root-run:0");
	} finally {
		if (previousAgentPath === undefined) delete process.env[PI_STUFF_AGENT_PATH_ENV];
		else process.env[PI_STUFF_AGENT_PATH_ENV] = previousAgentPath;
	}
});

test("Agents declares its exact workspace and certified Pi dependency contracts", async () => {
	const manifest = JSON.parse(await readFile(resolve(AGENTS_PACKAGE, "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		files?: string[];
		peerDependencies?: Record<string, string>;
	};
	const readWorkspaceVersion = async (packageDirectory: string): Promise<string> => {
		const packageManifest = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8")) as {
			version?: unknown;
		};
		if (typeof packageManifest.version !== "string") {
			throw new Error(`Workspace Package has no version: ${packageDirectory}`);
		}
		return packageManifest.version;
	};
	const [contextVersion, toolsVersion, uiVersion, workVersion] = await Promise.all([
		readWorkspaceVersion(CONTEXT_PACKAGE),
		readWorkspaceVersion(TOOLS_PACKAGE),
		readWorkspaceVersion(UI_PACKAGE),
		readWorkspaceVersion(WORK_PACKAGE),
	]);

	expect(manifest.dependencies).toEqual({
		"@jczhang02/pi-stuff-tools": toolsVersion,
		"@jczhang02/pi-stuff-ui": uiVersion,
		typebox: "1.3.7",
	});
	expect(manifest.peerDependencies).toEqual({
		"@jczhang02/pi-stuff-context": contextVersion,
		"@jczhang02/pi-stuff-work": workVersion,
		"@earendil-works/pi-agent-core": "*",
		"@earendil-works/pi-ai": "*",
		"@earendil-works/pi-coding-agent": "*",
		"@earendil-works/pi-tui": "*",
	});
	expect(manifest.devDependencies).toEqual({
		"@earendil-works/pi-agent-core": "0.83.0",
		"@earendil-works/pi-ai": "0.83.0",
		"@earendil-works/pi-coding-agent": "0.83.0",
		"@earendil-works/pi-tui": "0.83.0",
	});
	expect(manifest.files).toEqual(["index.ts", "agents", "src", "CHANGELOG.md", "README.md", "UPSTREAM.md", "LICENSE"]);
});

test("Pi 0.83 loads Agents through workspace dependency resolution", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-agents-host-"));
	TEMPORARY_ROOTS.push(root);
	const packageDirectory = join(root, "package");
	const dependencyScope = join(packageDirectory, "node_modules", "@jczhang02");
	await mkdir(dependencyScope, { recursive: true });
	await writeFile(
		join(packageDirectory, "package.json"),
		`${JSON.stringify(
			{
				name: "pi-stuff-agents-host-fixture",
				version: "0.0.0",
				type: "module",
				pi: { extensions: ["./index.ts"] },
			},
			null,
			"\t",
		)}\n`,
	);
	await writeFile(join(packageDirectory, "index.ts"), 'export { default } from "@jczhang02/pi-stuff-agents";\n');
	const installedAgents = join(dependencyScope, "pi-stuff-agents");
	const agentsDependencyScope = join(installedAgents, "node_modules", "@jczhang02");
	const sourceNodeModules = join(AGENTS_PACKAGE, "node_modules");
	await cp(AGENTS_PACKAGE, installedAgents, {
		recursive: true,
		filter: (source) => source !== sourceNodeModules,
	});
	await mkdir(agentsDependencyScope, { recursive: true });
	await Promise.all([
		cp(CONTEXT_PACKAGE, join(agentsDependencyScope, "pi-stuff-context"), {
			recursive: true,
			filter: (source) => source !== join(CONTEXT_PACKAGE, "node_modules"),
		}),
		cp(TOOLS_PACKAGE, join(agentsDependencyScope, "pi-stuff-tools"), { recursive: true }),
		cp(UI_PACKAGE, join(agentsDependencyScope, "pi-stuff-ui"), { recursive: true }),
		cp(WORK_PACKAGE, join(agentsDependencyScope, "pi-stuff-work"), {
			recursive: true,
			filter: (source) => source !== join(WORK_PACKAGE, "node_modules"),
		}),
	]);
	await symlink(TYPEBOX_PACKAGE, join(installedAgents, "node_modules", "typebox"), "dir");
	const result = await runPiRpcSmoke({ piBinary: PI_BINARY, packages: [packageDirectory] });

	expect(result.commandNames).toContain("agents");
	expect(result.stderr).toBe("");
});
