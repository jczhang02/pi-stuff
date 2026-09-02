import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export interface NativeDeleteOptions {
	readonly timeoutMs?: number;
	readonly trashExecutable?: string;
}

export type DeleteSessionResult =
	| { readonly method: "trash" | "unlink"; readonly ok: true }
	| { readonly error: string; readonly method: "unlink"; readonly ok: false };

export function deleteSessionFileNative(path: string, options: NativeDeleteOptions = {}): DeleteSessionResult {
	const executable = options.trashExecutable ?? "trash";
	const args = path.startsWith("-") ? ["--", path] : [path];
	const result = spawnSync(executable, args, {
		stdio: "ignore",
		timeout: options.timeoutMs ?? 2_000,
	});
	if ((!result.error && result.status === 0) || !existsSync(path)) return { method: "trash", ok: true };
	try {
		unlinkSync(path);
		return { method: "unlink", ok: true };
	} catch {
		return { error: "trash and permanent deletion failed", method: "unlink", ok: false };
	}
}

export function renameSessionFileNative(path: string, name: string): void {
	SessionManager.open(path).appendSessionInfo(name);
}
