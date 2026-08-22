export interface DetachedSubprocess {
	readonly exitCode: number | null;
	readonly exited: Promise<number>;
	readonly pid: number;
	kill(signal?: number | NodeJS.Signals): void;
}

export interface DetachedProcessResult {
	readonly exitCode: number;
	readonly timedOut: boolean;
}

function processGroupExists(pid: number): boolean {
	if (process.platform === "win32") return false;
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		return Check(ERRNO_SCHEMA, error) && error.code === "EPERM";
	}
}

function signalDetachedProcessGroup(child: DetachedSubprocess, signal: NodeJS.Signals): void {
	if (process.platform !== "win32") {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch (error) {
			if (!Check(ERRNO_SCHEMA, error) || error.code !== "ESRCH") throw error;
			// Fall back to the leader when the platform did not create a process group.
		}
	}
	if (child.exitCode === null) child.kill(signal);
}

async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
	if (process.platform === "win32") return true;
	const deadline = Date.now() + timeoutMs;
	while (processGroupExists(pid) && Date.now() < deadline) await Bun.sleep(20);
	return !processGroupExists(pid);
}

export async function terminateDetachedProcessGroup(child: DetachedSubprocess, graceMs = 1_000): Promise<void> {
	signalDetachedProcessGroup(child, "SIGTERM");
	if (process.platform === "win32") {
		await Promise.race([child.exited, Bun.sleep(graceMs)]);
		if (child.exitCode === null) child.kill("SIGKILL");
	} else if (!(await waitForProcessGroupExit(child.pid, graceMs))) {
		signalDetachedProcessGroup(child, "SIGKILL");
	}
	await child.exited;
	if (!(await waitForProcessGroupExit(child.pid, 1_000))) {
		throw new Error(`Detached process group ${String(child.pid)} survived SIGKILL`);
	}
}

export async function waitForDetachedProcess(
	child: DetachedSubprocess,
	timeoutMs: number,
	graceMs = 1_000,
): Promise<DetachedProcessResult> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const outcome = await Promise.race([
		child.exited.then((exitCode) => ({ exitCode, timedOut: false as const })),
		new Promise<{ readonly timedOut: true }>((resolve) => {
			timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
		}),
	]);
	if (timer) clearTimeout(timer);
	if (!outcome.timedOut) {
		// A leader can exit while descendants keep inherited stdout/stderr pipes
		// open. Drain that surviving group so callers cannot hang while reading EOF.
		if (process.platform !== "win32" && processGroupExists(child.pid)) {
			await terminateDetachedProcessGroup(child, graceMs);
		}
		return outcome;
	}
	await terminateDetachedProcessGroup(child, graceMs);
	return { exitCode: await child.exited, timedOut: true };
}
import { Type } from "typebox";
import { Check } from "typebox/value";

const ERRNO_SCHEMA = Type.Object({ code: Type.Optional(Type.String()) }, { additionalProperties: true });
