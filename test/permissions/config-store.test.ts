import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getGlobalConfigPath, getProjectConfigPath } from "../../packages/pi-stuff-permissions/src/config-paths.js";
import { ConfigStore } from "../../packages/pi-stuff-permissions/src/config-store.js";
import {
	DEFAULT_EXTENSION_CONFIG,
	normalizePermissionSystemConfig,
} from "../../packages/pi-stuff-permissions/src/extension-config.js";
import { PermissionManager } from "../../packages/pi-stuff-permissions/src/permission-manager.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createStore(agentDir: string): ConfigStore {
	return new ConfigStore({
		agentDir,
		policyPaths: {
			getResolvedPolicyPaths: () => ({
				globalConfigPath: "",
				globalConfigExists: false,
				projectConfigPath: null,
				projectConfigExists: false,
				agentsDir: "",
				agentsDirExists: false,
				projectAgentsDir: null,
				projectAgentsDirExists: false,
			}),
		},
		logger: {
			debug: () => {},
			review: () => {},
		} as never,
	});
}

describe("permission runtime ownership", () => {
	test("defaults to quiet unrestricted operation", () => {
		expect(normalizePermissionSystemConfig({})).toEqual(DEFAULT_EXTENSION_CONFIG);
	});

	test("only manual mode raises the builtin fallback to an approval", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-stuff-permission-mode-"));
		roots.push(root);
		const loaderPaths = {
			globalConfigPath: join(root, "missing-config.json"),
			agentsDir: join(root, "missing-agents"),
			globalMcpConfigPath: join(root, "missing-mcp.json"),
		};

		const unrestricted = new PermissionManager(loaderPaths);
		const manual = new PermissionManager({
			...loaderPaths,
			isManualModeEnabled: () => true,
		});

		expect(unrestricted.getToolPermission("read")).toBe("allow");
		expect(manual.getToolPermission("read")).toBe("ask");
	});

	test("trusted project content cannot take runtime authority or shell enrollment", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-stuff-permission-config-"));
		roots.push(root);
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		await writeJson(getGlobalConfigPath(agentDir), {
			permissionMode: "unrestricted",
			authorizerChain: ["user-reviewer"],
			shellTools: {
				exec_command: { commandArgument: "cmd", workdirArgument: "workdir" },
			},
		});
		await writeJson(getProjectConfigPath(cwd), {
			permissionMode: "manual",
			debugLog: true,
			permissionReviewLog: true,
			yoloMode: true,
			doublePressToConfirm: true,
			authorizerChain: ["project-reviewer"],
			shellTools: {
				exec_command: { commandArgument: "ignored" },
			},
		});

		const store = createStore(agentDir);
		store.refresh({ cwd, ui: { notify: () => {} } } as unknown as ExtensionContext, true);

		expect(store.current()).toMatchObject({
			permissionMode: "unrestricted",
			debugLog: false,
			permissionReviewLog: false,
			yoloMode: false,
			doublePressToConfirm: false,
			authorizerChain: ["user-reviewer"],
			shellTools: {
				exec_command: { commandArgument: "cmd", workdirArgument: "workdir" },
			},
		});
	});

	test("project and session rules cannot relax a user-owned global deny", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-stuff-permission-floor-"));
		roots.push(root);
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		await writeJson(getGlobalConfigPath(agentDir), {
			permission: { bash: { "*": "deny" } },
		});
		await writeJson(getProjectConfigPath(cwd), {
			permission: { bash: { "*": "allow" } },
		});

		const manager = new PermissionManager({ agentDir });
		manager.configureForCwd(cwd);
		const result = manager.check({ kind: "tool", surface: "bash", input: { command: "echo ok" } }, [
			{ surface: "bash", pattern: "*", action: "allow", layer: "session", origin: "session" },
		]);

		expect(result).toMatchObject({ state: "deny", origin: "global", matchedPattern: "*" });
		expect(manager.getToolPermission("bash")).toBe("deny");
	});

	test("an invalid global policy cannot silently fall back to unrestricted mode", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-stuff-invalid-global-"));
		roots.push(root);
		const agentDir = join(root, "agent");
		await mkdir(dirname(getGlobalConfigPath(agentDir)), { recursive: true });
		await writeFile(getGlobalConfigPath(agentDir), "{ invalid json");

		const manager = new PermissionManager({ agentDir });
		expect(manager.getToolPermission("bash")).toBe("ask");
		expect(manager.getConfigIssues()).toContainEqual(expect.stringContaining("Invalid global configuration"));
	});

	test("persists every setting exposed by the native settings list", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-stuff-permission-save-"));
		roots.push(root);
		const agentDir = join(root, "agent");
		const store = createStore(agentDir);
		store.save(
			{
				...DEFAULT_EXTENSION_CONFIG,
				permissionMode: "manual",
				permissionReviewLog: true,
				debugLog: true,
				doublePressToConfirm: true,
			},
			{ ui: { notify: () => {} } } as unknown as ExtensionCommandContext,
		);

		const saved = JSON.parse(await readFile(getGlobalConfigPath(agentDir), "utf8")) as Record<string, unknown>;
		expect(saved).toMatchObject({
			permissionMode: "manual",
			permissionReviewLog: true,
			debugLog: true,
			doublePressToConfirm: true,
		});
	});
});
