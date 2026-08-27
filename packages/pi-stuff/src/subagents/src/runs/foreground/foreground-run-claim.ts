import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseJsonValue } from "../../../../shared/json-value.js";
import { isRuntimeObject } from "../../../../shared/runtime-type.js";
import { ensurePrivateDirectory, readBoundedOwnedFile } from "../../shared/private-directory.ts";
import { readProcessStartIdentity } from "../../shared/process-identity.ts";
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
	try {
		fs.mkdirSync(asyncDir, { mode: 0o700 });
	} catch (error) {
		if (error && isRuntimeObject(error) && "code" in error && error.code === "EEXIST") {
			throw new Error(
				`Foreground Agent runtime '${asyncDir}' already exists; refusing to overwrite retained lifecycle evidence.`,
			);
		}
		throw error;
	}
	return { asyncDir, created: fs.lstatSync(asyncDir) };
}

/**
 * Create the exact private lifecycle directory and retain inode/token proof
 * until the foreground runner durably owns it.
 */
export function claimForegroundRunDirectory(
	runId: string,
	inheritedNestedRoute?: NestedRouteInfo,
): ForegroundRunDirectoryClaim {
	const { asyncDir, created } = createForegroundRunDirectory(runId, inheritedNestedRoute);
	const token = randomUUID();
	const markerPath = path.join(asyncDir, ".foreground-preparation-owner.json");
	try {
		ensurePrivateDirectory(asyncDir);
		fs.writeFileSync(
			markerPath,
			`${JSON.stringify({
				version: 2,
				token,
				pid: process.pid,
				processStartIdentity: readProcessStartIdentity(process.pid),
				createdAt: Date.now(),
				device: created.dev,
				inode: created.ino,
			})}\n`,
			{ encoding: "utf8", flag: "wx", mode: 0o600 },
		);
	} catch (error) {
		try {
			const current = fs.lstatSync(asyncDir);
			if (current.dev === created.dev && current.ino === created.ino) fs.rmSync(asyncDir, { recursive: true });
		} catch {
			// Preserve the original ownership/preparation failure.
		}
		throw error;
	}

	let committed = false;
	let removed = false;
	const stillCreatedInode = (): boolean => {
		if (removed) return false;
		try {
			const current = fs.lstatSync(asyncDir);
			return current.isDirectory() && current.dev === created.dev && current.ino === created.ino;
		} catch {
			return false;
		}
	};
	const stillOwned = (): boolean => {
		if (committed) return false;
		try {
			if (!stillCreatedInode()) return false;
			const marker = parseJsonValue(readBoundedOwnedFile(markerPath, 4 * 1024));
			return isRuntimeObject(marker) && marker !== null && !Array.isArray(marker) && marker["token"] === token;
		} catch {
			return false;
		}
	};
	const removeCreatedInode = (): boolean => {
		if (!stillCreatedInode()) return false;
		const failedPath = `${asyncDir}.failed-${token}`;
		try {
			fs.renameSync(asyncDir, failedPath);
			const moved = fs.lstatSync(failedPath);
			if (!moved.isDirectory() || moved.dev !== created.dev || moved.ino !== created.ino) return false;
			fs.rmSync(failedPath, { recursive: true });
			removed = true;
			return true;
		} catch {
			// An ownership race leaves evidence in place instead of deleting an
			// unproven directory.
			return false;
		}
	};
	return {
		asyncDir,
		cleanup: () => {
			if (!stillOwned()) return;
			removeCreatedInode();
		},
		commit: () => {
			if (!stillOwned()) return false;
			try {
				fs.unlinkSync(markerPath);
				committed = true;
				return true;
			} catch {
				return false;
			}
		},
		abortIfUnstarted: () => {
			if (removed) return true;
			if (!committed || !stillCreatedInode()) return false;
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
			return removeCreatedInode();
		},
	};
}
