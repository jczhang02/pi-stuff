import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { codeModeHostBinaryName, HOST_RELEASE } from "./host-assets.js";
import { installCodeModeHost } from "./install-host.js";

function packageRoot(): string {
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

function cachedBinaryPath(platform: string, arch: string, agentDir = getAgentDir()): string {
	return join(
		agentDir,
		"cache",
		"pi-stuff-code-mode",
		HOST_RELEASE,
		`${platform}-${arch}`,
		codeModeHostBinaryName(platform),
	);
}

export function codeModeHostBinaryPath(
	platform = process.platform,
	arch = process.arch,
	agentDir = getAgentDir(),
): string {
	const override = process.env["PI_STUFF_CODE_MODE_HOST"];
	if (override) {
		if (!isAbsolute(override) || !existsSync(override)) {
			throw new Error("PI_STUFF_CODE_MODE_HOST must point to an existing absolute path");
		}
		return override;
	}
	const name = codeModeHostBinaryName(platform);
	const bundled = join(packageRoot(), "bin", `${platform}-${arch}`, name);
	if (existsSync(bundled)) return bundled;
	const cached = cachedBinaryPath(platform, arch, agentDir);
	if (existsSync(cached)) return cached;
	throw new Error(`No Code Mode host binary for ${platform}-${arch}`);
}

export async function ensureCodeModeHostBinary(signal?: AbortSignal): Promise<string> {
	try {
		return codeModeHostBinaryPath();
	} catch (error) {
		if (process.env["PI_STUFF_CODE_MODE_HOST"]) throw error;
		const destination = cachedBinaryPath(process.platform, process.arch);
		await installCodeModeHost({
			arch: process.arch,
			destination,
			platform: process.platform,
			...(signal ? { signal } : {}),
		});
		return codeModeHostBinaryPath();
	}
}
