import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface ProcessIdentity {
	readonly pid: number;
	readonly started: string;
}

function errorCode(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error
		? String((error as NodeJS.ErrnoException).code)
		: undefined;
}

/** Stable enough to distinguish a live process from a reused PID. */
export function processStartIdentity(pid: number): string | undefined {
	if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
	if (process.platform === "linux") {
		try {
			const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
			const commandEnd = stat.lastIndexOf(")");
			if (commandEnd === -1) return undefined;
			const startTicks = stat
				.slice(commandEnd + 1)
				.trim()
				.split(/\s+/u)[19];
			return startTicks ? `linux:${startTicks}` : undefined;
		} catch {
			return undefined;
		}
	}
	if (process.platform === "darwin" || process.platform === "freebsd") {
		const result = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
			encoding: "utf-8",
		});
		const started = result.status === 0 ? result.stdout.trim() : "";
		return started ? `${process.platform}:${started}` : undefined;
	}
	return undefined;
}

export function captureProcessIdentity(pid: number): ProcessIdentity | undefined {
	const started = processStartIdentity(pid);
	return started ? { pid, started } : undefined;
}

export function identityMatches(identity: ProcessIdentity): boolean {
	return processStartIdentity(identity.pid) === identity.started;
}

export function processExists(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return errorCode(error) === "EPERM";
	}
}

function processGroupExists(pgid: number): boolean {
	if (!Number.isSafeInteger(pgid) || pgid <= 0 || process.platform === "win32") return false;
	try {
		process.kill(-pgid, 0);
		return true;
	} catch (error) {
		return errorCode(error) === "EPERM";
	}
}

export function signalProcessGroup(pgid: number, signal: NodeJS.Signals): boolean {
	if (!Number.isSafeInteger(pgid) || pgid <= 0) return false;
	try {
		if (process.platform === "win32") process.kill(pgid, signal);
		else process.kill(-pgid, signal);
		return true;
	} catch {
		try {
			process.kill(pgid, signal);
			return true;
		} catch {
			return false;
		}
	}
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Stop a process tree whose leader identity has already been verified.
 * Verification happens once before TERM; the short grace window cannot switch
 * authority to a newly reused PID.
 */
export async function terminateVerifiedProcessGroup(
	identity: ProcessIdentity,
	graceMs = 1_500,
): Promise<"identity-mismatch" | "killed" | "stopped"> {
	if (!identityMatches(identity)) return "identity-mismatch";
	signalProcessGroup(identity.pid, "SIGTERM");
	const deadline = Date.now() + Math.max(0, graceMs);
	while (Date.now() < deadline) {
		if (!processGroupExists(identity.pid)) return "stopped";
		await delay(Math.min(50, Math.max(1, deadline - Date.now())));
	}
	if (!processGroupExists(identity.pid)) return "stopped";
	signalProcessGroup(identity.pid, "SIGKILL");
	return "killed";
}

/** Clean descendants after an owned shell leader has already exited. */
export async function reapOwnedProcessGroup(pgid: number, graceMs = 150): Promise<void> {
	if (!processGroupExists(pgid)) return;
	signalProcessGroup(pgid, "SIGTERM");
	await delay(graceMs);
	if (processGroupExists(pgid)) signalProcessGroup(pgid, "SIGKILL");
}
