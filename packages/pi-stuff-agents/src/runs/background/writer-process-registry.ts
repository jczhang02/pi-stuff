import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { writeAtomicJson } from "../../shared/atomic-json.ts";

const WRITER_PROCESS_REGISTRY_FILE = "writer-processes-live.json";

export type WriterRuntimeState = { state: "none" | "spawning" } | { state: "running"; pid: number };

interface PersistedWriterState {
	state: "none" | "spawning" | "running";
	pid?: number;
	processStartIdentity?: string;
}

interface WriterProcessRegistry {
	version: 1;
	runId: string;
	runnerPid: number;
	updatedAt: number;
	writers: Record<string, PersistedWriterState>;
}

type KillFn = (pid: number, signal?: NodeJS.Signals | 0) => unknown;

export function writerProcessRegistryPath(asyncDir: string): string {
	return path.join(asyncDir, WRITER_PROCESS_REGISTRY_FILE);
}

export function initializeWriterProcessRegistry(
	asyncDir: string,
	runId: string,
	runnerPid: number,
	childCount: number,
): void {
	const writers = Object.fromEntries(
		Array.from({ length: childCount }, (_, index) => [String(index), { state: "none" as const }]),
	);
	writeAtomicJson(writerProcessRegistryPath(asyncDir), {
		version: 1,
		runId,
		runnerPid,
		updatedAt: Date.now(),
		writers,
	} satisfies WriterProcessRegistry);
}

export function updateWriterProcessRegistry(asyncDir: string, index: number, state: WriterRuntimeState): void {
	if (!Number.isSafeInteger(index) || index < 0) throw new TypeError("writer process index must be non-negative");
	const registry = readWriterProcessRegistry(asyncDir);
	if (!registry) throw new Error(`Writer process registry is unavailable for '${asyncDir}'.`);
	const startIdentity = state.state === "running" ? processStartIdentity(state.pid) : undefined;
	registry.writers[String(index)] =
		state.state === "running"
			? {
					state: "running",
					pid: state.pid,
					...(startIdentity ? { processStartIdentity: startIdentity } : {}),
				}
			: { state: state.state };
	registry.updatedAt = Date.now();
	writeAtomicJson(writerProcessRegistryPath(asyncDir), registry);
}

/** `true`/`undefined` retain the governor lease; only explicit `false` permits reclamation. */
export function inspectWriterProcessLiveness(asyncDir: string, kill: KillFn = process.kill): boolean | undefined {
	const registryPath = writerProcessRegistryPath(asyncDir);
	if (!fs.existsSync(registryPath)) return undefined;
	const registry = readWriterProcessRegistry(asyncDir);
	if (!registry) return undefined;
	let unknown = false;
	for (const writer of Object.values(registry.writers)) {
		if (writer.state === "spawning") return true;
		if (writer.state !== "running" || writer.pid === undefined) continue;
		const state = processLiveness(writer.pid, kill);
		if (state === false) continue;
		if (state === undefined) unknown = true;
		else {
			const identity = processStartIdentity(writer.pid);
			if (writer.processStartIdentity && identity && identity !== writer.processStartIdentity) continue;
			if (!writer.processStartIdentity || !identity) unknown = true;
			else return true;
		}
	}
	return unknown ? undefined : false;
}

/** Kill writers orphaned by a dead runner. Unknown/unconfirmable writers remain recorded and counted. */
export function terminateOrphanWriterProcesses(
	asyncDir: string,
	kill: KillFn = process.kill,
): { remaining: number; terminated: number } {
	const registryPath = writerProcessRegistryPath(asyncDir);
	if (!fs.existsSync(registryPath)) return { remaining: 1, terminated: 0 };
	const registry = readWriterProcessRegistry(asyncDir);
	if (!registry) return { remaining: 1, terminated: 0 };
	let changed = false;
	let remaining = 0;
	let terminated = 0;

	for (const [index, writer] of Object.entries(registry.writers)) {
		if (writer.state === "none") continue;
		if (writer.state === "spawning") {
			// No writer PID has been durably bound yet, so no process can be signalled safely.
			remaining += 1;
			continue;
		}

		if (writer.pid === undefined) {
			remaining += 1;
			continue;
		}
		const liveness = processLiveness(writer.pid, kill);
		if (liveness === false) {
			registry.writers[index] = { state: "none" };
			changed = true;
			continue;
		}
		if (liveness === undefined) {
			remaining += 1;
			continue;
		}
		const identity = processStartIdentity(writer.pid);
		if (writer.processStartIdentity && identity && identity !== writer.processStartIdentity) {
			registry.writers[index] = { state: "none" };
			changed = true;
			continue;
		}
		if (!writer.processStartIdentity || !identity) {
			remaining += 1;
			continue;
		}
		try {
			kill(writer.pid, "SIGKILL");
			registry.writers[index] = { state: "none" };
			changed = true;
			terminated += 1;
		} catch (error) {
			if (errorCode(error) === "ESRCH") {
				registry.writers[index] = { state: "none" };
				changed = true;
			} else {
				remaining += 1;
			}
		}
	}

	if (changed) {
		registry.updatedAt = Date.now();
		writeAtomicJson(registryPath, registry);
	}
	return { remaining, terminated };
}

function readWriterProcessRegistry(asyncDir: string): WriterProcessRegistry | undefined {
	try {
		const value = JSON.parse(fs.readFileSync(writerProcessRegistryPath(asyncDir), "utf-8")) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
		const candidate = value as Partial<WriterProcessRegistry>;
		if (
			candidate.version !== 1 ||
			typeof candidate.runId !== "string" ||
			!positiveInteger(candidate.runnerPid) ||
			typeof candidate.updatedAt !== "number" ||
			!candidate.writers ||
			typeof candidate.writers !== "object" ||
			Array.isArray(candidate.writers)
		) {
			return undefined;
		}
		const writers: Record<string, PersistedWriterState> = {};
		for (const [index, writer] of Object.entries(candidate.writers)) {
			if (!/^\d+$/.test(index) || !validWriterState(writer)) return undefined;
			writers[index] = { ...writer };
		}
		return {
			version: 1,
			runId: candidate.runId,
			runnerPid: candidate.runnerPid,
			updatedAt: candidate.updatedAt,
			writers,
		};
	} catch {
		return undefined;
	}
}

function validWriterState(value: unknown): value is PersistedWriterState {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const writer = value as PersistedWriterState;
	if (writer.state !== "none" && writer.state !== "spawning" && writer.state !== "running") return false;
	if (writer.state === "running") {
		return (
			positiveInteger(writer.pid) &&
			(writer.processStartIdentity === undefined || typeof writer.processStartIdentity === "string")
		);
	}
	return writer.pid === undefined && writer.processStartIdentity === undefined;
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function processLiveness(pid: number, kill: KillFn): boolean | undefined {
	try {
		kill(pid, 0);
		return true;
	} catch (error) {
		if (errorCode(error) === "ESRCH") return false;
		return undefined;
	}
}

function processStartIdentity(pid: number): string | undefined {
	if (process.platform === "linux") {
		try {
			const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
			const commandEnd = stat.lastIndexOf(")");
			if (commandEnd === -1) return undefined;
			const startTicks = stat
				.slice(commandEnd + 1)
				.trim()
				.split(/\s+/)[19];
			return startTicks ? `linux:${startTicks}` : undefined;
		} catch {
			return undefined;
		}
	}
	if (process.platform === "darwin" || process.platform === "freebsd") {
		const result = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf-8" });
		const started = result.status === 0 ? result.stdout.trim() : "";
		return started ? `${process.platform}:${started}` : undefined;
	}
	return undefined;
}

function errorCode(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error
		? String((error as NodeJS.ErrnoException).code)
		: undefined;
}
