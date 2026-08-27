import {
	inspectWriterChildProcessLiveness,
	inspectWriterProcessLiveness,
	terminateOrphanWriterProcesses,
} from "../runs/background/writer-process-registry.ts";
import { readForegroundOwnerExit } from "../runs/foreground/owner-exit.ts";
import { readStatus } from "../shared/utils.ts";
import type { AgentGovernorLease } from "./session-governor.ts";

export type RuntimeProcessState = (pid: number, lease: AgentGovernorLease) => boolean | undefined;

export function createRuntimeProcessState(options: {
	readonly isPidAlive: (pid: number) => boolean | undefined;
	readonly readProcessStartIdentity: (pid: number) => string | undefined;
	readonly readSystemBootIdentity: () => string | undefined;
}): RuntimeProcessState {
	let systemBootIdentity: string | undefined;
	let systemBootIdentityRead = false;
	const currentSystemBootIdentity = (): string | undefined => {
		if (!systemBootIdentityRead) {
			try {
				systemBootIdentity = options.readSystemBootIdentity();
			} catch {
				systemBootIdentity = undefined;
			}
			systemBootIdentityRead = true;
		}
		return systemBootIdentity;
	};

	return (pid, lease) => {
		const currentBootIdentity = lease.systemBootIdentity === undefined ? undefined : currentSystemBootIdentity();
		if (
			lease.systemBootIdentity !== undefined &&
			currentBootIdentity !== undefined &&
			lease.systemBootIdentity !== currentBootIdentity
		) {
			return false;
		}
		if (lease.asyncDir && readForegroundOwnerExit(lease.asyncDir, lease.runtimeRunId)) {
			try {
				// A foreground execution frame lives inside the long-running Pi Host.
				// Its durable owner-exit marker supersedes that Host PID: only the
				// exact child writer registry may keep this lease alive now.
				terminateOrphanWriterProcesses(lease.asyncDir);
				return inspectWriterChildProcessLiveness(lease.asyncDir, lease.childIndex);
			} catch {
				return undefined;
			}
		}
		let runnerState = options.isPidAlive(pid);
		if (runnerState === true) {
			const currentIdentity = options.readProcessStartIdentity(pid);
			runnerState =
				lease.processStartIdentity === undefined || currentIdentity === undefined
					? undefined
					: lease.processStartIdentity === currentIdentity;
		}
		if (lease.asyncDir) {
			let status: ReturnType<typeof readStatus>;
			try {
				status = readStatus(lease.asyncDir);
			} catch {
				// Status is semantic evidence, not process-liveness authority. If
				// the runner is OS-proven dead, the authenticated writer registry can
				// still prove that no process remains and release capacity. Unknown
				// runner/writer identity remains fail-closed.
				if (runnerState !== false) return undefined;
				terminateOrphanWriterProcesses(lease.asyncDir);
				return inspectWriterProcessLiveness(lease.asyncDir);
			}
			const step = status?.steps?.[lease.childIndex];
			if (
				status?.runId === lease.runtimeRunId &&
				step &&
				(step.status === "complete" ||
					step.status === "completed" ||
					step.status === "failed" ||
					step.status === "paused" ||
					step.status === "stopped")
			) {
				let writerState = inspectWriterChildProcessLiveness(lease.asyncDir, lease.childIndex);
				if (
					writerState !== false &&
					(runnerState === false ||
						status.state === "complete" ||
						status.state === "failed" ||
						status.state === "paused" ||
						status.state === "stopped")
				) {
					terminateOrphanWriterProcesses(lease.asyncDir);
					writerState = inspectWriterChildProcessLiveness(lease.asyncDir, lease.childIndex);
				}
				return writerState;
			}
		}
		if (runnerState !== false || !lease.asyncDir) return runnerState;
		terminateOrphanWriterProcesses(lease.asyncDir);
		return inspectWriterProcessLiveness(lease.asyncDir);
	};
}
