import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isRuntimeObject } from "../../shared/runtime-type.js";

export interface ProcessIdentity {
	readonly pid: number;
	readonly started: string;
}

function errorCode(cause: unknown): string | undefined {
	return cause && isRuntimeObject(cause) && "code" in cause
		? String((cause as NodeJS.ErrnoException).code)
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

function waitForIdentityRetry(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

/**
 * Newly spawned processes can exist briefly before their platform start marker
 * is readable. Retry that observation before deciding launch authority is
 * unavailable; never substitute the numeric PID itself as authority.
 */
export async function captureProcessIdentityWithRetry(
	pid: number,
	timeoutMs = 250,
	deps: {
		readonly capture?: (pid: number) => ProcessIdentity | undefined;
		readonly exists?: (pid: number) => boolean;
		readonly now?: () => number;
		readonly wait?: (milliseconds: number) => Promise<void>;
	} = {},
): Promise<ProcessIdentity | undefined> {
	const capture = deps.capture ?? captureProcessIdentity;
	const exists = deps.exists ?? processExists;
	const now = deps.now ?? Date.now;
	const wait = deps.wait ?? waitForIdentityRetry;
	const deadline = now() + Math.max(0, timeoutMs);
	for (;;) {
		const identity = capture(pid);
		if (identity) return identity;
		const remaining = deadline - now();
		if (remaining <= 0 || !exists(pid)) return undefined;
		await wait(Math.min(20, remaining));
	}
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
		process.kill(process.platform === "win32" ? pgid : -pgid, signal);
		return true;
	} catch {
		// On Unix, a failed group signal must never fall back to +pid: the
		// leader may have exited and that numeric PID may now name an unrelated
		// process. Windows has no negative process-group target.
		return false;
	}
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Stop a process tree whose leader identity has already been verified.
 * Re-verify the leader before every destructive signal. A numeric process-group
 * id is not durable authority after the original leader disappears.
 */
export async function terminateVerifiedProcessGroup(
	identity: ProcessIdentity,
	graceMs = 1_500,
): Promise<"identity-mismatch" | "killed" | "stopped" | "unresolved"> {
	if (!identityMatches(identity)) {
		const currentIdentity = processStartIdentity(identity.pid);
		if (currentIdentity !== undefined || processExists(identity.pid)) return "identity-mismatch";
		// A stale numeric PGID cannot prove that the original group existed
		// continuously; it may have disappeared and been reused before recovery.
		return processGroupExists(identity.pid) ? "unresolved" : "identity-mismatch";
	}
	signalProcessGroup(identity.pid, "SIGTERM");
	const deadline = Date.now() + Math.max(0, graceMs);
	while (Date.now() < deadline) {
		if (!processGroupExists(identity.pid)) return "stopped";
		await delay(Math.min(50, Math.max(1, deadline - Date.now())));
	}
	if (!processGroupExists(identity.pid)) return "stopped";
	if (!identityMatches(identity)) {
		return processGroupExists(identity.pid) ? "unresolved" : "stopped";
	}
	signalProcessGroup(identity.pid, "SIGKILL");
	const killDeadline = Date.now() + Math.max(500, Math.min(2_000, graceMs));
	while (Date.now() < killDeadline) {
		if (!processGroupExists(identity.pid)) return "killed";
		await delay(Math.min(50, Math.max(1, killDeadline - Date.now())));
	}
	return processGroupExists(identity.pid) ? "unresolved" : "killed";
}

/** Clean descendants without ever transferring authority to a reused numeric PID. */
export async function reapOwnedProcessGroup(identity: ProcessIdentity, graceMs = 150): Promise<void> {
	const outcome = await terminateVerifiedProcessGroup(identity, graceMs);
	if (outcome === "unresolved") {
		throw new Error(`Process group ${identity.pid} remained alive or unverifiable after SIGKILL.`);
	}
}
