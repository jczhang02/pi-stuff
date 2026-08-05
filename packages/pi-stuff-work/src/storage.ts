import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	captureProcessIdentity,
	identityMatches,
	type ProcessIdentity,
	processExists,
	processStartIdentity,
	terminateVerifiedProcessGroup,
} from "./process.js";

const SCHEMA_VERSION = 1;
const OWNED_DIRECTORY_PREFIX = "pi-stuff-";
const METADATA_FILE = "runtime.json";

export interface StoredProcessTask {
	readonly command?: ProcessIdentity;
	readonly id: string;
	readonly supervisor: ProcessIdentity;
}

interface StoredRuntime {
	readonly owner: ProcessIdentity;
	readonly schemaVersion: 1;
	readonly tasks: readonly StoredProcessTask[];
}

function safeToken(value: string): string {
	const normalized = value.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
	return normalized.slice(0, 64) || "session";
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseIdentity(value: unknown): ProcessIdentity | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	return isPositiveInteger(record["pid"]) && typeof record["started"] === "string" && record["started"]
		? { pid: record["pid"], started: record["started"] }
		: undefined;
}

function parseStoredRuntime(value: unknown): StoredRuntime | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const owner = parseIdentity(record["owner"]);
	if (record["schemaVersion"] !== SCHEMA_VERSION || !owner || !Array.isArray(record["tasks"])) return undefined;
	const tasks: StoredProcessTask[] = [];
	for (const value of record["tasks"]) {
		if (!value || typeof value !== "object") return undefined;
		const task = value as Record<string, unknown>;
		const supervisor = parseIdentity(task["supervisor"]);
		const command = task["command"] === undefined ? undefined : parseIdentity(task["command"]);
		if (typeof task["id"] !== "string" || !task["id"] || !supervisor || (task["command"] && !command)) {
			return undefined;
		}
		tasks.push({ id: task["id"], supervisor, ...(command ? { command } : {}) });
	}
	return { owner, schemaVersion: SCHEMA_VERSION, tasks };
}

function readStoredRuntime(directory: string): StoredRuntime | undefined {
	try {
		return parseStoredRuntime(JSON.parse(readFileSync(join(directory, METADATA_FILE), "utf-8")));
	} catch {
		return undefined;
	}
}

function removeOwnedDirectory(root: string, directory: string): void {
	const resolvedRoot = resolve(root);
	const resolvedDirectory = resolve(directory);
	if (dirname(resolvedDirectory) !== resolvedRoot || !basename(resolvedDirectory).startsWith(OWNED_DIRECTORY_PREFIX)) {
		throw new Error(`Refusing to remove non-owned Background Work directory: ${resolvedDirectory}`);
	}
	rmSync(resolvedDirectory, { force: true, recursive: true });
}

export interface ReconciliationResult {
	readonly cleanedDirectories: number;
	readonly killedProcesses: number;
	readonly unresolvedDirectories: number;
}

/** Reap process trees left by an abruptly terminated Pi Host. Never creates files. */
export async function reconcileStaleRuns(cwd: string): Promise<ReconciliationResult> {
	const root = join(cwd, ".pi", "tasks");
	if (!existsSync(root)) return { cleanedDirectories: 0, killedProcesses: 0, unresolvedDirectories: 0 };
	let cleanedDirectories = 0;
	let killedProcesses = 0;
	let unresolvedDirectories = 0;
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith(OWNED_DIRECTORY_PREFIX)) continue;
		const directory = join(root, entry.name);
		const stored = readStoredRuntime(directory);
		if (!stored) {
			unresolvedDirectories += 1;
			continue;
		}
		if (identityMatches(stored.owner)) continue;
		let unresolved = false;
		for (const task of stored.tasks) {
			for (const identity of [task.command, task.supervisor]) {
				if (!identity) continue;
				if (!processExists(identity.pid)) continue;
				const currentIdentity = processStartIdentity(identity.pid);
				if (currentIdentity && currentIdentity !== identity.started) continue;
				if (!currentIdentity) {
					unresolved = true;
					continue;
				}
				const outcome = await terminateVerifiedProcessGroup(identity, 2_000);
				if (outcome !== "identity-mismatch") killedProcesses += 1;
			}
		}
		if (unresolved) {
			unresolvedDirectories += 1;
			continue;
		}
		removeOwnedDirectory(root, directory);
		cleanedDirectories += 1;
	}
	return { cleanedDirectories, killedProcesses, unresolvedDirectories };
}

export class WorkRunStorage {
	private directoryValue: string | undefined;
	private readonly owner: ProcessIdentity;
	private readonly root: string;
	private readonly sessionId: string;
	private tasks: readonly StoredProcessTask[] = [];

	constructor(cwd: string, sessionId: string) {
		const owner = captureProcessIdentity(process.pid);
		if (!owner) throw new Error("Background Work requires a stable Pi process identity");
		this.owner = owner;
		this.root = join(cwd, ".pi", "tasks");
		this.sessionId = safeToken(sessionId);
	}

	get directory(): string | undefined {
		return this.directoryValue;
	}

	ensureDirectory(): string {
		if (this.directoryValue) return this.directoryValue;
		mkdirSync(this.root, { mode: 0o700, recursive: true });
		const token = randomBytes(6).toString("hex");
		const directory = join(this.root, `${OWNED_DIRECTORY_PREFIX}${this.sessionId}-${String(process.pid)}-${token}`);
		mkdirSync(directory, { mode: 0o700 });
		this.directoryValue = directory;
		this.persist([]);
		return directory;
	}

	outputPath(id: string): string {
		return join(this.ensureDirectory(), `${safeToken(id)}.output`);
	}

	persist(tasks: readonly StoredProcessTask[]): void {
		const directory = this.ensureDirectory();
		this.tasks = [...tasks];
		const target = join(directory, METADATA_FILE);
		const temporary = join(directory, `.${METADATA_FILE}.${randomBytes(6).toString("hex")}.tmp`);
		const content: StoredRuntime = { owner: this.owner, schemaVersion: SCHEMA_VERSION, tasks: this.tasks };
		writeFileSync(temporary, `${JSON.stringify(content, null, 2)}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
		renameSync(temporary, target);
	}

	cleanup(): void {
		const directory = this.directoryValue;
		if (!directory) return;
		this.tasks = [];
		removeOwnedDirectory(this.root, directory);
		this.directoryValue = undefined;
	}
}
