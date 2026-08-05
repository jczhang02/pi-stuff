import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { prepareMagicContext } from "../../packages/pi-stuff-context/config.js";

const roots: string[] = [];
const environment = process.env as NodeJS.ProcessEnv & {
	HOME?: string;
	PI_CODING_AGENT_DIR?: string;
	XDG_CONFIG_HOME?: string;
};
const ORIGINAL_ENV = {
	HOME: environment.HOME,
	PI_CODING_AGENT_DIR: environment.PI_CODING_AGENT_DIR,
	XDG_CONFIG_HOME: environment.XDG_CONFIG_HOME,
};

interface BootstrapConfig {
	embedding?: { provider?: unknown };
	historian?: { model?: unknown };
	todowrite?: unknown;
	toast_duration_ms?: unknown;
}

function restoreEnvironment(): void {
	for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
}

async function isolatedEnvironment(): Promise<{ agent: string; canonical: string; root: string }> {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-context-config-"));
	roots.push(root);
	const agent = join(root, "agent");
	const xdg = join(root, "config");
	environment.HOME = root;
	environment.PI_CODING_AGENT_DIR = agent;
	environment.XDG_CONFIG_HOME = xdg;
	return { agent, canonical: join(xdg, "cortexkit", "magic-context.jsonc"), root };
}

function extensionContext(): ExtensionContext {
	return {
		model: { id: "fixture-model", provider: "fixture-provider" },
	} as unknown as ExtensionContext;
}

afterEach(async () => {
	restoreEnvironment();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.serial("Magic Context first-use configuration", () => {
	test("creates one private canonical config on lazy activation", async () => {
		const paths = await isolatedEnvironment();

		await prepareMagicContext(extensionContext());

		const config = JSON.parse(await readFile(paths.canonical, "utf8")) as BootstrapConfig;
		expect(config.historian?.model).toBe("fixture-provider/fixture-model");
		expect(config.embedding?.provider).toBe("off");
		expect(config.todowrite).toEqual({ enabled: false, overlay: false });
		expect(config.toast_duration_ms).toBe(0);
		expect((await stat(paths.canonical)).mode & 0o777).toBe(0o600);

		await writeFile(paths.canonical, '{"enabled":false}\n', "utf8");
		await chmod(paths.canonical, 0o640);
		await prepareMagicContext(extensionContext());
		expect(await readFile(paths.canonical, "utf8")).toBe('{"enabled":false}\n');
		expect((await stat(paths.canonical)).mode & 0o777).toBe(0o640);
	});

	test("preserves a legacy Pi config instead of creating a competing canonical file", async () => {
		const paths = await isolatedEnvironment();
		await mkdir(paths.agent, { recursive: true });
		const legacy = join(paths.agent, "magic-context.jsonc");
		await writeFile(legacy, '{"historian":{"model":"legacy/model"}}\n', "utf8");

		await prepareMagicContext(extensionContext());

		expect(await readFile(legacy, "utf8")).toContain("legacy/model");
		expect(await Bun.file(paths.canonical).exists()).toBeFalse();
	});
});
