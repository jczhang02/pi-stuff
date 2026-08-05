import { access, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_HISTORIAN_MODEL = "openai-codex/gpt-5.6-terra";
const environment = process.env as NodeJS.ProcessEnv & {
	PI_CODING_AGENT_DIR?: string;
	XDG_CONFIG_HOME?: string;
};

function canonicalConfigPath(): string {
	const configHome = environment.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
	return join(configHome, "cortexkit", "magic-context.jsonc");
}

function legacyPiConfigPath(): string {
	return join(homedir(), ".pi", "agent", "magic-context.jsonc");
}

function configuredPiConfigPath(): string | undefined {
	const agentDirectory = environment.PI_CODING_AGENT_DIR?.trim();
	return agentDirectory ? join(agentDirectory, "magic-context.jsonc") : undefined;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function historianModel(ctx: ExtensionContext): string {
	const provider = ctx.model?.provider?.trim();
	const id = ctx.model?.id?.trim();
	return provider && id ? `${provider}/${id}` : DEFAULT_HISTORIAN_MODEL;
}

function defaultConfig(ctx: ExtensionContext): string {
	return `${JSON.stringify(
		{
			$schema: "https://raw.githubusercontent.com/cortexkit/magic-context/master/assets/magic-context.schema.json",
			enabled: true,
			fail_closed_blocking: false,
			toast_duration_ms: 0,
			historian: {
				model: historianModel(ctx),
				thinking_level: "medium",
			},
			embedding: {
				provider: "off",
			},
			dreamer: { disable: true },
			sidekick: { disable: true },
			todowrite: { enabled: false, overlay: false },
			memory: { enabled: true, auto_search: { enabled: true } },
		},
		null,
		"\t",
	)}\n`;
}

/**
 * Give a first-time Pi Stuff installation a usable official Magic Context
 * configuration without overwriting either its canonical or legacy user file.
 * This runs only on lazy activation, never during Pi startup discovery.
 */
export async function prepareMagicContext(ctx: ExtensionContext): Promise<void> {
	const path = canonicalConfigPath();
	const configured = configuredPiConfigPath();
	if (
		(await exists(path)) ||
		(await exists(legacyPiConfigPath())) ||
		(configured !== undefined && (await exists(configured)))
	)
		return;
	await mkdir(dirname(path), { mode: 0o700, recursive: true });
	let file: Awaited<ReturnType<typeof open>> | undefined;
	try {
		file = await open(path, "wx", 0o600);
		await file.writeFile(defaultConfig(ctx), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	} finally {
		await file?.close();
	}
}
