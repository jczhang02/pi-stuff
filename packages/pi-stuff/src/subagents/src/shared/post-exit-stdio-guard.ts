import type { ChildProcess } from "node:child_process";
import { isRuntimeNumber } from "../../../shared/runtime-type.js";
import { readProcessStartIdentity } from "./process-identity.ts";

interface PostExitStdioGuardOptions {
	idleMs: number;
	hardMs: number;
}

interface ChildWithPipedStdio {
	stdout: ChildProcess["stdout"];
	stderr: ChildProcess["stderr"];
	on: ChildProcess["on"];
}

interface ChildWithKill {
	pid?: number | undefined;
	kill(signal?: NodeJS.Signals | number): boolean;
}

export function trySignalChild(
	child: ChildWithKill,
	signal: NodeJS.Signals,
	expectedProcessStartIdentity?: string,
): boolean {
	if (process.platform !== "win32" && isRuntimeNumber(child.pid)) {
		if (!expectedProcessStartIdentity) return false;
		if (expectedProcessStartIdentity) {
			const currentIdentity = readProcessStartIdentity(child.pid);
			if (currentIdentity && currentIdentity !== expectedProcessStartIdentity) return false;
			if (!currentIdentity) {
				try {
					process.kill(child.pid, 0);
				} catch {}
				// Whether the PID is unreadable or absent, a numeric PGID alone does
				// not prove continuity with the writer captured at spawn time.
				return false;
			}
		}
		try {
			process.kill(-child.pid, signal);
			return true;
		} catch {
			return false;
		}
	}
	if (process.platform !== "win32") return false;
	try {
		return child.kill(signal);
	} catch {
		return false;
	}
}

export function attachPostExitStdioGuard(child: ChildWithPipedStdio, options: PostExitStdioGuardOptions): () => void {
	const { idleMs, hardMs } = options;
	let exited = false;
	let stdoutEnded = false;
	let stderrEnded = false;
	let idleTimer: NodeJS.Timeout | undefined;
	let hardTimer: NodeJS.Timeout | undefined;

	const destroyUnendedStdio = () => {
		if (!stdoutEnded) {
			try {
				child.stdout?.destroy();
			} catch {}
		}
		if (!stderrEnded) {
			try {
				child.stderr?.destroy();
			} catch {}
		}
	};

	const clearTimers = () => {
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = undefined;
		}
		if (hardTimer) {
			clearTimeout(hardTimer);
			hardTimer = undefined;
		}
	};

	const armIdleTimer = () => {
		if (!exited) return;
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(destroyUnendedStdio, idleMs);
		idleTimer.unref?.();
	};

	child.stdout?.on("data", armIdleTimer);
	child.stderr?.on("data", armIdleTimer);
	child.stdout?.on("end", () => {
		stdoutEnded = true;
		if (stdoutEnded && stderrEnded) clearTimers();
	});
	child.stderr?.on("end", () => {
		stderrEnded = true;
		if (stdoutEnded && stderrEnded) clearTimers();
	});
	child.on("exit", () => {
		exited = true;
		armIdleTimer();
		if (hardTimer) return;
		hardTimer = setTimeout(destroyUnendedStdio, hardMs);
		hardTimer.unref?.();
	});
	child.on("close", clearTimers);
	child.on("error", clearTimers);

	return clearTimers;
}
