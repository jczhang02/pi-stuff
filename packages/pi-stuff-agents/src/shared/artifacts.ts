import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { type ArtifactDirPreference, type ArtifactPaths, TEMP_ARTIFACTS_DIR } from "./types.ts";
import { getAgentDir } from "./utils.ts";

const CLEANUP_MARKER_FILE = ".last-cleanup";
const PROJECT_ARTIFACT_ROOT = ".pi-subagents";
const ARTIFACT_DIRECTORY_NAME = "subagent-artifacts";
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MAX_ARTIFACT_DIRECTORIES_PER_PASS = 5_000;
const MAX_ARTIFACT_ENTRIES_PER_PASS = 50_000;
const SCAN_YIELD_INTERVAL = 32;

export interface ArtifactMaintenanceReport {
	readonly directoriesInspected: number;
	readonly filesRemoved: number;
	readonly bytesReclaimed: number;
	readonly scanComplete: boolean;
}

export interface ArtifactMaintenanceOptions {
	readonly sessionsRoot?: string;
	readonly tempArtifactsDir?: string;
	readonly now?: number;
	readonly maxDirectories?: number;
	readonly maxEntries?: number;
}

export function getProjectSubagentsDir(cwd: string): string {
	return path.join(cwd, PROJECT_ARTIFACT_ROOT);
}

export function getProjectArtifactsDir(cwd: string): string {
	return path.join(getProjectSubagentsDir(cwd), "artifacts");
}

export function getArtifactsDir(
	sessionFile: string | null,
	projectCwd?: string,
	dirPreference: ArtifactDirPreference = "session",
): string {
	switch (dirPreference) {
		case "session":
			if (sessionFile) {
				const sessionDir = path.dirname(sessionFile);
				return path.join(sessionDir, "subagent-artifacts");
			}
			return TEMP_ARTIFACTS_DIR;
		case "temp":
			return TEMP_ARTIFACTS_DIR;
		case "project":
			if (projectCwd) return getProjectArtifactsDir(projectCwd);
			if (sessionFile) {
				const sessionDir = path.dirname(sessionFile);
				return path.join(sessionDir, "subagent-artifacts");
			}
			return TEMP_ARTIFACTS_DIR;
		default:
			throw new Error(
				`Unsupported artifactDir ${JSON.stringify(dirPreference)}; expected "project", "session", or "temp".`,
			);
	}
}

export function getArtifactPaths(artifactsDir: string, runId: string, agent: string, index?: number): ArtifactPaths {
	const suffix = index !== undefined ? `_${index}` : "";
	const safeAgent = agent.replace(/[^\w.-]/g, "_");
	const base = `${runId}_${safeAgent}${suffix}`;
	return {
		inputPath: path.join(artifactsDir, `${base}_input.md`),
		outputPath: path.join(artifactsDir, `${base}_output.md`),
		jsonlPath: path.join(artifactsDir, `${base}.jsonl`),
		transcriptPath: path.join(artifactsDir, `${base}_transcript.jsonl`),
		metadataPath: path.join(artifactsDir, `${base}_meta.json`),
	};
}

export function ensureArtifactsDir(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}

export function writeArtifact(filePath: string, content: string): void {
	fs.writeFileSync(filePath, content, "utf-8");
}

export function formatOutputArtifactContent(input: {
	output: string;
	error?: string;
	transcriptPath?: string;
	metadataPath?: string;
}): string {
	if (input.output.trim() || !input.error) return input.output;
	const lines = ["Subagent run failed before producing output.", "", "Error:", input.error];
	if (input.transcriptPath) lines.push("", `Transcript: ${input.transcriptPath}`);
	if (input.metadataPath) lines.push(`Metadata: ${input.metadataPath}`);
	return lines.join("\n");
}

export function writeMetadata(filePath: string, metadata: object): void {
	fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), "utf-8");
}

export function appendJsonl(filePath: string, line: string): void {
	fs.appendFileSync(filePath, `${line}\n`);
}

export function cleanupOldArtifacts(dir: string, maxAgeDays: number): void {
	if (!fs.existsSync(dir)) return;

	const markerPath = path.join(dir, CLEANUP_MARKER_FILE);
	const now = Date.now();

	if (fs.existsSync(markerPath)) {
		const stat = fs.statSync(markerPath);
		if (now - stat.mtimeMs < 24 * 60 * 60 * 1000) return;
	}

	const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
	const cutoff = now - maxAgeMs;

	for (const file of fs.readdirSync(dir)) {
		if (file === CLEANUP_MARKER_FILE) continue;
		const filePath = path.join(dir, file);
		try {
			const stat = fs.lstatSync(filePath);
			const currentUid = process.getuid?.();
			if (
				stat.isFile() &&
				!stat.isSymbolicLink() &&
				(currentUid === undefined || stat.uid === currentUid) &&
				stat.mtimeMs < cutoff
			) {
				fs.unlinkSync(filePath);
			}
		} catch {
			// Artifact cleanup is best-effort housekeeping. Skip files that disappear
			// or become unreadable while scanning so one bad entry does not block the rest.
		}
	}

	fs.writeFileSync(markerPath, String(now));
}

async function ownedDirectory(directory: string): Promise<boolean> {
	try {
		const stat = await fs.promises.lstat(directory);
		const currentUid = process.getuid?.();
		return stat.isDirectory() && !stat.isSymbolicLink() && (currentUid === undefined || stat.uid === currentUid);
	} catch {
		return false;
	}
}

async function cleanupMarkerIsFresh(directory: string, now: number): Promise<boolean> {
	try {
		const marker = await fs.promises.lstat(path.join(directory, CLEANUP_MARKER_FILE));
		const currentUid = process.getuid?.();
		return (
			marker.isFile() &&
			!marker.isSymbolicLink() &&
			(currentUid === undefined || marker.uid === currentUid) &&
			now - marker.mtimeMs < CLEANUP_INTERVAL_MS
		);
	} catch {
		return false;
	}
}

async function writeCleanupMarker(directory: string, now: number): Promise<void> {
	const marker = path.join(directory, CLEANUP_MARKER_FILE);
	const temporary = path.join(directory, `.${CLEANUP_MARKER_FILE}.${randomUUID()}.tmp`);
	try {
		await fs.promises.writeFile(temporary, `${String(now)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
		await fs.promises.rename(temporary, marker);
	} finally {
		try {
			await fs.promises.unlink(temporary);
		} catch {
			// Atomic rename already consumed the temporary, or best-effort cleanup failed.
		}
	}
}

interface ArtifactCleanupBudget {
	entries: number;
	readonly maxEntries: number;
}

async function cleanArtifactDirectory(
	directory: string,
	cutoff: number,
	now: number,
	budget: ArtifactCleanupBudget,
): Promise<{ filesRemoved: number; bytesReclaimed: number; complete: boolean }> {
	if (!(await ownedDirectory(directory)) || (await cleanupMarkerIsFresh(directory, now))) {
		return { filesRemoved: 0, bytesReclaimed: 0, complete: true };
	}
	let filesRemoved = 0;
	let bytesReclaimed = 0;
	let complete = true;
	try {
		const entries = await fs.promises.opendir(directory);
		for await (const entry of entries) {
			if (entry.name === CLEANUP_MARKER_FILE) continue;
			if (budget.entries >= budget.maxEntries) {
				complete = false;
				break;
			}
			budget.entries += 1;
			const candidate = path.join(directory, entry.name);
			try {
				const stat = await fs.promises.lstat(candidate);
				const currentUid = process.getuid?.();
				if (
					stat.isFile() &&
					!stat.isSymbolicLink() &&
					(currentUid === undefined || stat.uid === currentUid) &&
					stat.mtimeMs < cutoff
				) {
					await fs.promises.unlink(candidate);
					filesRemoved += 1;
					bytesReclaimed += stat.size;
				}
			} catch {
				// Files can disappear while a detached runner finishes; continue safely.
			}
			if (budget.entries % SCAN_YIELD_INTERVAL === 0) await eventLoopTurn();
		}
	} catch {
		return { filesRemoved, bytesReclaimed, complete: false };
	}
	if (complete) {
		try {
			await writeCleanupMarker(directory, now);
		} catch {
			// A failed throttle marker only makes a later pass repeat safe cleanup.
		}
	}
	return { filesRemoved, bytesReclaimed, complete };
}

async function findSessionArtifactDirectories(
	root: string,
	maximum: number,
	now: number,
	budget: ArtifactCleanupBudget,
): Promise<{ directories: string[]; complete: boolean }> {
	if (!(await ownedDirectory(root))) return { directories: [], complete: true };
	const pending = [root];
	const directories: string[] = [];
	let complete = true;
	while (pending.length > 0 && directories.length < maximum) {
		const directory = pending.pop();
		if (!directory) break;
		let entries: fs.Dir;
		try {
			entries = await fs.promises.opendir(directory);
		} catch {
			continue;
		}
		for await (const entry of entries) {
			if (budget.entries >= budget.maxEntries) {
				complete = false;
				break;
			}
			budget.entries += 1;
			if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
			const candidate = path.join(directory, entry.name);
			if (!(await ownedDirectory(candidate))) continue;
			if (entry.name === ARTIFACT_DIRECTORY_NAME) {
				// Completed batches carry a fresh marker. Skipping them lets later
				// interactions advance through a tree larger than one bounded pass.
				if (!(await cleanupMarkerIsFresh(candidate, now))) {
					directories.push(candidate);
					if (directories.length >= maximum) {
						complete = false;
						break;
					}
				}
			} else pending.push(candidate);
			if (budget.entries % SCAN_YIELD_INTERVAL === 0) await eventLoopTurn();
		}
		if (!complete) break;
	}
	if (pending.length > 0) complete = false;
	return { directories, complete };
}

/**
 * Reclaim old default Agent artifacts after an explicit Agent interaction.
 * The bounded, yielding walk never follows symlinks and intentionally leaves
 * directories in place so session layout and in-flight writers stay intact.
 */
export async function maintainAgentArtifacts(
	maxAgeDays: number,
	options: ArtifactMaintenanceOptions = {},
): Promise<ArtifactMaintenanceReport> {
	const now = options.now ?? Date.now();
	const cutoff = now - Math.max(0, maxAgeDays) * 24 * 60 * 60 * 1_000;
	const maxDirectories = options.maxDirectories ?? MAX_ARTIFACT_DIRECTORIES_PER_PASS;
	const discoveryBudget: ArtifactCleanupBudget = {
		entries: 0,
		maxEntries: options.maxEntries ?? MAX_ARTIFACT_ENTRIES_PER_PASS,
	};
	const cleanupBudget: ArtifactCleanupBudget = {
		entries: 0,
		maxEntries: options.maxEntries ?? MAX_ARTIFACT_ENTRIES_PER_PASS,
	};
	const sessionsRoot = options.sessionsRoot ?? path.join(getAgentDir(), "sessions");
	const discovered = await findSessionArtifactDirectories(sessionsRoot, maxDirectories, now, discoveryBudget);
	const tempArtifactsDir = options.tempArtifactsDir ?? TEMP_ARTIFACTS_DIR;
	const directories = [tempArtifactsDir, ...discovered.directories];
	let directoriesInspected = 0;
	let filesRemoved = 0;
	let bytesReclaimed = 0;
	let scanComplete = discovered.complete;
	for (const directory of directories) {
		if (cleanupBudget.entries >= cleanupBudget.maxEntries) {
			scanComplete = false;
			break;
		}
		if (!(await ownedDirectory(directory))) continue;
		directoriesInspected += 1;
		const cleaned = await cleanArtifactDirectory(directory, cutoff, now, cleanupBudget);
		filesRemoved += cleaned.filesRemoved;
		bytesReclaimed += cleaned.bytesReclaimed;
		if (!cleaned.complete) scanComplete = false;
	}
	return { directoriesInspected, filesRemoved, bytesReclaimed, scanComplete };
}

function eventLoopTurn(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

export function cleanupAllArtifactDirs(maxAgeDays: number): void {
	cleanupOldArtifacts(TEMP_ARTIFACTS_DIR, maxAgeDays);

	const sessionsBase = path.join(getAgentDir(), "sessions");
	if (!fs.existsSync(sessionsBase)) return;

	let dirs: string[];
	try {
		dirs = fs.readdirSync(sessionsBase);
	} catch {
		// Session artifact cleanup is best-effort. If the sessions root cannot be read,
		// skip cleanup instead of failing extension startup.
		return;
	}

	for (const dir of dirs) {
		const artifactsDir = path.join(sessionsBase, dir, "subagent-artifacts");
		try {
			cleanupOldArtifacts(artifactsDir, maxAgeDays);
		} catch {
			// Session cleanup is best-effort. Keep going so one unreadable session dir
			// does not block cleanup for the rest.
		}
	}
}
