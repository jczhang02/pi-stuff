import * as fs from "node:fs";
import * as path from "node:path";
import { claimPreparedRunDirectory, ensurePrivateDirectory } from "../../shared/private-directory.ts";
import { type NestedRouteInfo, TEMP_ROOT_DIR } from "../../shared/types.ts";
import { readStatus } from "../../shared/utils.ts";
import { inspectWriterProcessLiveness } from "../background/writer-process-registry.ts";

export interface ForegroundRunDirectoryClaim {
	readonly asyncDir: string;
	/** Remove only the directory inode and token created by this invocation. */
	cleanup(): void;
	/** Relinquish the preparation token after binding succeeds. */
	commit(): boolean;
	/** Reclaim a committed directory only when the runner never durably started. */
	abortIfUnstarted(): boolean;
}

function createForegroundRunDirectory(runId: string, inheritedNestedRoute?: NestedRouteInfo) {
	if (!/^[a-f0-9]{12}$/u.test(runId)) throw new Error("Invalid internal Agent launch identity.");
	ensurePrivateDirectory(TEMP_ROOT_DIR);
	let asyncDir: string;
	if (inheritedNestedRoute) {
		const nestedRunsRoot = path.join(TEMP_ROOT_DIR, "nested-subagent-runs");
		const rootRunDir = path.join(nestedRunsRoot, inheritedNestedRoute.rootRunId);
		asyncDir = path.join(rootRunDir, runId);
		ensurePrivateDirectory(nestedRunsRoot);
		ensurePrivateDirectory(rootRunDir);
	} else {
		const foregroundRoot = path.join(TEMP_ROOT_DIR, "foreground-runs");
		asyncDir = path.join(foregroundRoot, runId);
		ensurePrivateDirectory(foregroundRoot);
	}
	return asyncDir;
}

/**
 * Create the exact private lifecycle directory and retain inode/token proof
 * until the foreground runner durably owns it.
 */
export function claimForegroundRunDirectory(
	runId: string,
	inheritedNestedRoute?: NestedRouteInfo,
): ForegroundRunDirectoryClaim {
	const asyncDir = createForegroundRunDirectory(runId, inheritedNestedRoute);
	const prepared = claimPreparedRunDirectory(asyncDir, "foreground");
	return {
		asyncDir,
		cleanup: prepared.cleanup,
		commit: prepared.commit,
		abortIfUnstarted: () => {
			if (prepared.isRemoved()) return true;
			if (!prepared.isCommitted() || !prepared.stillCreated()) return false;
			if (inspectWriterProcessLiveness(asyncDir) !== false) return false;
			if (fs.existsSync(path.join(asyncDir, "completion.json"))) return false;
			const status = readStatus(asyncDir);
			if (
				status &&
				(status.runId !== runId ||
					(status.state !== "running" && status.state !== "queued") ||
					!status.steps?.every((step) => step.status === "pending"))
			) {
				return false;
			}
			return prepared.removeCreated();
		},
	};
}
