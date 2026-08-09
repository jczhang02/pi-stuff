import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { type ArtifactDirPreference, type ArtifactPaths, TEMP_ARTIFACTS_DIR } from "./types.ts";
import { getAgentDir } from "./utils.ts";

const CLEANUP_MARKER_FILE = ".last-cleanup";
const CLEANUP_CURSOR_FILE = ".cleanup-cursor";
const PROJECT_ARTIFACT_ROOT = ".pi-subagents";
const ARTIFACT_DIRECTORY_NAME = "subagent-artifacts";
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MAX_ARTIFACT_DIRECTORIES_PER_PASS = 5_000;
const MAX_ARTIFACT_ENTRIES_PER_PASS = 50_000;
const SCAN_YIELD_INTERVAL = 32;
const ARTIFACT_SUFFIXES = ["_input.md", "_output.md", "_transcript.jsonl", "_meta.json", ".jsonl"] as const;

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

function artifactBaseName(fileName: string): string | undefined {
	for (const suffix of ARTIFACT_SUFFIXES) {
		if (fileName.endsWith(suffix) && fileName.length > suffix.length) return fileName.slice(0, -suffix.length);
	}
	return undefined;
}

function artifactGroupNames(base: string): string[] {
	return ARTIFACT_SUFFIXES.map((suffix) => `${base}${suffix}`);
}

function orderedArtifactGroupNames(base: string): string[] {
	return artifactGroupNames(base).sort((left, right) => {
		const terminalProofOrder = Number(left.endsWith("_meta.json")) - Number(right.endsWith("_meta.json"));
		return terminalProofOrder || left.localeCompare(right);
	});
}

function isTerminalArtifactMetadata(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const metadata = value as { state?: unknown; exitCode?: unknown };
	if (metadata.state === "running" || metadata.state === "queued") return false;
	if (["complete", "failed", "stopped"].includes(String(metadata.state))) return true;
	// Metadata written before lifecycle state was added is terminal because this
	// file was emitted only after the child process had settled.
	return typeof metadata.exitCode === "number" && Number.isFinite(metadata.exitCode);
}

function ownedRegularFile(stat: fs.Stats): boolean {
	const currentUid = process.getuid?.();
	return stat.isFile() && !stat.isSymbolicLink() && (currentUid === undefined || stat.uid === currentUid);
}

function terminalArtifactGroupSync(directory: string, base: string, cutoff: number): boolean {
	try {
		const metadataPath = path.join(directory, `${base}_meta.json`);
		const metadataStat = fs.lstatSync(metadataPath);
		if (!ownedRegularFile(metadataStat) || metadataStat.mtimeMs >= cutoff || metadataStat.size > 64 * 1024)
			return false;
		if (!isTerminalArtifactMetadata(JSON.parse(fs.readFileSync(metadataPath, "utf8")))) return false;
		for (const name of artifactGroupNames(base)) {
			const candidate = path.join(directory, name);
			if (!fs.existsSync(candidate)) continue;
			const stat = fs.lstatSync(candidate);
			if (!ownedRegularFile(stat) || stat.mtimeMs >= cutoff) return false;
		}
		return true;
	} catch {
		return false;
	}
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

	const removedGroups = new Set<string>();
	for (const file of fs.readdirSync(dir)) {
		const base = artifactBaseName(file);
		if (!base || removedGroups.has(base) || !terminalArtifactGroupSync(dir, base, cutoff)) continue;
		const names = orderedArtifactGroupNames(base);
		let safelyRemoved = true;
		for (const name of names) {
			try {
				const candidate = path.join(dir, name);
				const stat = fs.lstatSync(candidate);
				if (!ownedRegularFile(stat) || stat.mtimeMs >= cutoff) {
					safelyRemoved = false;
					break;
				}
				fs.unlinkSync(candidate);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					safelyRemoved = false;
					break;
				}
			}
		}
		if (safelyRemoved) removedGroups.add(base);
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

async function readCleanupCursor(directory: string): Promise<string | undefined> {
	try {
		const cursorPath = path.join(directory, CLEANUP_CURSOR_FILE);
		const stat = await fs.promises.lstat(cursorPath);
		if (!ownedRegularFile(stat) || stat.size > 4_096) return undefined;
		const value = JSON.parse(await fs.promises.readFile(cursorPath, "utf8"));
		return typeof value === "string" && value ? value : undefined;
	} catch {
		return undefined;
	}
}

async function writeCleanupCursor(directory: string, value: string): Promise<void> {
	const cursor = path.join(directory, CLEANUP_CURSOR_FILE);
	const temporary = path.join(directory, `.${CLEANUP_CURSOR_FILE}.${randomUUID()}.tmp`);
	try {
		await fs.promises.writeFile(temporary, `${JSON.stringify(value)}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		await fs.promises.rename(temporary, cursor);
	} finally {
		try {
			await fs.promises.unlink(temporary);
		} catch {
			// Atomic rename already consumed the temporary, or best-effort cleanup failed.
		}
	}
}

async function terminalArtifactGroup(directory: string, base: string, cutoff: number): Promise<boolean> {
	try {
		const metadataPath = path.join(directory, `${base}_meta.json`);
		const metadataStat = await fs.promises.lstat(metadataPath);
		if (!ownedRegularFile(metadataStat) || metadataStat.mtimeMs >= cutoff || metadataStat.size > 64 * 1024)
			return false;
		const metadata = JSON.parse(await fs.promises.readFile(metadataPath, "utf8"));
		if (!isTerminalArtifactMetadata(metadata)) return false;
		for (const name of artifactGroupNames(base)) {
			try {
				const stat = await fs.promises.lstat(path.join(directory, name));
				if (!ownedRegularFile(stat) || stat.mtimeMs >= cutoff) return false;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
			}
		}
		return true;
	} catch {
		return false;
	}
}

async function removeTerminalArtifactGroup(
	directory: string,
	base: string,
	cutoff: number,
): Promise<{ filesRemoved: number; bytesReclaimed: number }> {
	if (!(await terminalArtifactGroup(directory, base, cutoff))) return { filesRemoved: 0, bytesReclaimed: 0 };
	let filesRemoved = 0;
	let bytesReclaimed = 0;
	// Metadata is the terminal proof, so remove it last. Every unlink is preceded
	// by a fresh ownership/age check to fail safe if a resumed writer touched it.
	const names = orderedArtifactGroupNames(base);
	for (const name of names) {
		const candidate = path.join(directory, name);
		try {
			const stat = await fs.promises.lstat(candidate);
			if (!ownedRegularFile(stat) || stat.mtimeMs >= cutoff) return { filesRemoved, bytesReclaimed };
			await fs.promises.unlink(candidate);
			filesRemoved += 1;
			bytesReclaimed += stat.size;
		} catch (error) {
			// Missing siblings are valid for disabled artifact kinds; other failures
			// leave the remaining group intact for a later safe pass.
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { filesRemoved, bytesReclaimed };
		}
	}
	return { filesRemoved, bytesReclaimed };
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
	let lastProcessed: string | undefined;
	try {
		const entries = (await fs.promises.readdir(directory, { withFileTypes: true })).sort((left, right) =>
			left.name.localeCompare(right.name),
		);
		const cursor = await readCleanupCursor(directory);
		let start = cursor ? entries.findIndex((entry) => entry.name > cursor) : 0;
		if (start < 0) start = entries.length;
		for (let index = start; index < entries.length; index += 1) {
			const entry = entries[index];
			if (!entry || entry.name === CLEANUP_MARKER_FILE || entry.name === CLEANUP_CURSOR_FILE) continue;
			if (budget.entries >= budget.maxEntries) {
				complete = false;
				break;
			}
			budget.entries += 1;
			lastProcessed = entry.name;
			const base = artifactBaseName(entry.name);
			if (base) {
				const removed = await removeTerminalArtifactGroup(directory, base, cutoff);
				filesRemoved += removed.filesRemoved;
				bytesReclaimed += removed.bytesReclaimed;
			}
			if (budget.entries % SCAN_YIELD_INTERVAL === 0) await eventLoopTurn();
		}
	} catch {
		return { filesRemoved, bytesReclaimed, complete: false };
	}
	if (complete) {
		try {
			await fs.promises.unlink(path.join(directory, CLEANUP_CURSOR_FILE)).catch(() => undefined);
			await writeCleanupMarker(directory, now);
		} catch {
			// A failed throttle marker only makes a later pass repeat safe cleanup.
		}
	} else {
		if (lastProcessed) await writeCleanupCursor(directory, lastProcessed).catch(() => undefined);
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
	// Session directories come first so a large shared temp directory cannot
	// consume the entire bounded cleanup budget on every interaction. The cursor
	// in each incomplete directory guarantees eventual progress within a batch.
	const directories = [...discovered.directories, tempArtifactsDir];
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
