import * as fs from "node:fs";
import * as path from "node:path";

export interface BunRuntimeResolutionOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly execPath?: string;
	readonly executableFile?: (filePath: string) => boolean;
}

function defaultExecutableFile(filePath: string): boolean {
	try {
		fs.accessSync(filePath, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

/** Resolve an explicit Bun executable without relying on Node being installed. */
export function resolveBunRuntimeCommand(options: BunRuntimeResolutionOptions = {}): string | undefined {
	const executable = process.platform === "win32" ? "bun.exe" : "bun";
	const executableFile = options.executableFile ?? defaultExecutableFile;
	const execPath = options.execPath ?? process.execPath;
	if (path.basename(execPath).toLowerCase() === executable && executableFile(execPath)) return execPath;
	const env = options.env ?? process.env;
	const bunInstall = env.BUN_INSTALL?.trim();
	if (bunInstall) {
		const candidate = path.join(bunInstall, "bin", executable);
		if (executableFile(candidate)) return candidate;
	}
	for (const directory of (env.PATH ?? "").split(path.delimiter)) {
		if (!directory) continue;
		const candidate = path.join(directory, executable);
		if (executableFile(candidate)) return candidate;
	}
	return undefined;
}
