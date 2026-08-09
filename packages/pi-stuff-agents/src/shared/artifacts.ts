import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { type ArtifactDirPreference, type ArtifactPaths, TEMP_ARTIFACTS_DIR } from "./types.ts";
import { getAgentDir } from "./utils.ts";

const CLEANUP_MARKER_FILE = ".last-cleanup";
const CLEANUP_CURSOR_FILE = ".cleanup-cursor";
const CLEANUP_SNAPSHOT_FILE = ".cleanup-snapshot.jsonl";
const DISCOVERY_CURSOR_FILE = ".artifact-cleanup-frontier";
const DISCOVERY_SNAPSHOT_DIRECTORY = ".artifact-cleanup-snapshots";
const PROJECT_ARTIFACT_ROOT = ".pi-subagents";
const ARTIFACT_DIRECTORY_NAME = "subagent-artifacts";
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MAX_ARTIFACT_DIRECTORIES_PER_PASS = 5_000;
const MAX_ARTIFACT_ENTRIES_PER_PASS = 50_000;
const SCAN_YIELD_INTERVAL = 32;
const MAX_DISCOVERY_CURSOR_BYTES = 1024 * 1024;
const SNAPSHOT_BUFFER_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
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

function safeSnapshotName(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 4_096 &&
		value !== "." &&
		value !== ".." &&
		!value.includes("/") &&
		!value.includes("\\") &&
		!value.includes("\0")
	);
}

async function buildNameSnapshot(
	directory: string,
	target: string,
	accept: (entry: fs.Dirent) => boolean,
): Promise<void> {
	const temporary = `${target}.${randomUUID()}.tmp`;
	let handle: fs.promises.FileHandle | undefined;
	try {
		handle = await fs.promises.open(temporary, "wx", 0o600);
		let buffered = "";
		let bufferedBytes = 0;
		let snapshotBytes = 0;
		let scanned = 0;
		const flush = async (): Promise<void> => {
			if (!buffered) return;
			await handle?.write(buffered);
			buffered = "";
			bufferedBytes = 0;
		};
		const entries = await fs.promises.opendir(directory);
		for await (const entry of entries) {
			scanned += 1;
			if (scanned % SCAN_YIELD_INTERVAL === 0) await eventLoopTurn();
			if (!accept(entry)) continue;
			const line = `${JSON.stringify(entry.name)}\n`;
			const lineBytes = Buffer.byteLength(line, "utf8");
			snapshotBytes += lineBytes;
			if (snapshotBytes > MAX_SNAPSHOT_BYTES) throw new Error("Artifact maintenance snapshot exceeded its bound.");
			buffered += line;
			bufferedBytes += lineBytes;
			if (bufferedBytes >= SNAPSHOT_BUFFER_BYTES) await flush();
		}
		await flush();
		await handle.close();
		handle = undefined;
		await fs.promises.rename(temporary, target);
	} finally {
		await handle?.close().catch(() => undefined);
		await fs.promises.unlink(temporary).catch(() => undefined);
	}
}

interface NameSnapshotPage {
	readonly names: string[];
	readonly records: number;
	readonly nextOffset: number;
	readonly complete: boolean;
}

async function readNameSnapshotPage(filePath: string, offset: number, limit: number): Promise<NameSnapshotPage> {
	const stat = await fs.promises.lstat(filePath);
	if (!ownedRegularFile(stat) || stat.size > MAX_SNAPSHOT_BYTES)
		throw new Error("Invalid artifact maintenance snapshot.");
	if (limit <= 0 || offset >= stat.size) {
		return { names: [], records: 0, nextOffset: Math.min(offset, stat.size), complete: offset >= stat.size };
	}
	const handle = await fs.promises.open(filePath, "r");
	try {
		const names: string[] = [];
		let records = 0;
		let readPosition = Math.max(0, offset);
		let nextOffset = readPosition;
		let carry = Buffer.alloc(0);
		while (records < limit && readPosition < stat.size) {
			const chunk = Buffer.allocUnsafe(Math.min(SNAPSHOT_BUFFER_BYTES, stat.size - readPosition));
			const { bytesRead } = await handle.read(chunk, 0, chunk.length, readPosition);
			if (bytesRead <= 0) break;
			const combined = carry.length
				? Buffer.concat([carry, chunk.subarray(0, bytesRead)])
				: chunk.subarray(0, bytesRead);
			const combinedStart = readPosition - carry.length;
			let lineStart = 0;
			for (let index = 0; index < combined.length && records < limit; index += 1) {
				if (combined[index] !== 0x0a) continue;
				const raw = combined.subarray(lineStart, index).toString("utf8");
				records += 1;
				nextOffset = combinedStart + index + 1;
				try {
					const parsed = JSON.parse(raw);
					if (safeSnapshotName(parsed)) names.push(parsed);
				} catch {
					// A malformed owned snapshot record is skipped without broadening deletion.
				}
				lineStart = index + 1;
			}
			readPosition += bytesRead;
			carry = records >= limit ? Buffer.alloc(0) : Buffer.from(combined.subarray(lineStart));
		}
		if (records < limit && readPosition >= stat.size) nextOffset = stat.size;
		return { names, records, nextOffset, complete: nextOffset >= stat.size };
	} finally {
		await handle.close();
	}
}

async function readCleanupCursor(directory: string): Promise<number> {
	try {
		const cursorPath = path.join(directory, CLEANUP_CURSOR_FILE);
		const stat = await fs.promises.lstat(cursorPath);
		if (!ownedRegularFile(stat) || stat.size > 4_096) return 0;
		const value = JSON.parse(await fs.promises.readFile(cursorPath, "utf8")) as { offset?: unknown };
		return typeof value.offset === "number" && Number.isSafeInteger(value.offset) && value.offset >= 0
			? value.offset
			: 0;
	} catch {
		return 0;
	}
}

async function writeCleanupCursor(directory: string, offset: number): Promise<void> {
	const cursor = path.join(directory, CLEANUP_CURSOR_FILE);
	const temporary = path.join(directory, `.${CLEANUP_CURSOR_FILE}.${randomUUID()}.tmp`);
	try {
		await fs.promises.writeFile(temporary, `${JSON.stringify({ version: 1, offset })}\n`, {
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
	let complete = false;
	const snapshot = path.join(directory, CLEANUP_SNAPSHOT_FILE);
	try {
		try {
			const stat = await fs.promises.lstat(snapshot);
			if (!ownedRegularFile(stat)) throw new Error("Invalid artifact cleanup snapshot.");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			await buildNameSnapshot(
				directory,
				snapshot,
				(entry) =>
					entry.name !== CLEANUP_MARKER_FILE &&
					entry.name !== CLEANUP_CURSOR_FILE &&
					entry.name !== CLEANUP_SNAPSHOT_FILE &&
					artifactBaseName(entry.name) !== undefined,
			);
		}
		const cursor = await readCleanupCursor(directory);
		const page = await readNameSnapshotPage(snapshot, cursor, Math.max(0, budget.maxEntries - budget.entries));
		budget.entries += page.records;
		for (const name of page.names) {
			const base = artifactBaseName(name);
			if (base) {
				const removed = await removeTerminalArtifactGroup(directory, base, cutoff);
				filesRemoved += removed.filesRemoved;
				bytesReclaimed += removed.bytesReclaimed;
			}
		}
		complete = page.complete;
		if (!complete) await writeCleanupCursor(directory, page.nextOffset);
	} catch {
		await fs.promises.unlink(snapshot).catch(() => undefined);
		await fs.promises.unlink(path.join(directory, CLEANUP_CURSOR_FILE)).catch(() => undefined);
		return { filesRemoved, bytesReclaimed, complete: false };
	}
	if (complete) {
		try {
			await fs.promises.unlink(path.join(directory, CLEANUP_CURSOR_FILE)).catch(() => undefined);
			await fs.promises.unlink(snapshot).catch(() => undefined);
			await writeCleanupMarker(directory, now);
		} catch {
			// A failed throttle marker only makes a later pass repeat safe cleanup.
		}
	}
	return { filesRemoved, bytesReclaimed, complete };
}

interface DiscoveryFrame {
	readonly directory: string;
	readonly snapshot?: string;
	readonly offset?: number;
	readonly artifact?: true;
}

interface DiscoveryFrontier {
	readonly version: 2;
	readonly pending: DiscoveryFrame[];
}

function safeDiscoveryDirectory(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.length > 4_096 || path.isAbsolute(value)) return false;
	return !value.split(/[\\/]+/u).some((part) => part === ".." || part.includes("\0"));
}

function safeDiscoverySnapshot(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f-]{36}\.jsonl$/u.test(value);
}

async function ensureDiscoverySnapshotDirectory(root: string): Promise<string> {
	const directory = path.join(root, DISCOVERY_SNAPSHOT_DIRECTORY);
	try {
		await fs.promises.mkdir(directory, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	if (!(await ownedDirectory(directory))) throw new Error("Invalid artifact discovery snapshot directory.");
	return directory;
}

function resolveDiscoverySnapshot(snapshotDirectory: string, snapshot: string): string | undefined {
	if (!safeDiscoverySnapshot(snapshot)) return undefined;
	const resolvedDirectory = path.resolve(snapshotDirectory);
	const candidate = path.resolve(resolvedDirectory, snapshot);
	return path.dirname(candidate) === resolvedDirectory ? candidate : undefined;
}

async function removeDiscoverySnapshot(snapshotDirectory: string, snapshot: string | undefined): Promise<void> {
	if (!snapshot) return;
	const candidate = resolveDiscoverySnapshot(snapshotDirectory, snapshot);
	if (!candidate) return;
	try {
		const stat = await fs.promises.lstat(candidate);
		if (ownedRegularFile(stat)) await fs.promises.unlink(candidate);
	} catch {
		// A missing or invalid owned control file is safe to leave for a later pass.
	}
}

async function readDiscoveryFrontier(root: string): Promise<DiscoveryFrame[] | undefined> {
	try {
		const cursorPath = path.join(root, DISCOVERY_CURSOR_FILE);
		const stat = await fs.promises.lstat(cursorPath);
		if (!ownedRegularFile(stat) || stat.size > MAX_DISCOVERY_CURSOR_BYTES) return undefined;
		const parsed = JSON.parse(await fs.promises.readFile(cursorPath, "utf8")) as Partial<DiscoveryFrontier>;
		if (
			parsed.version !== 2 ||
			!Array.isArray(parsed.pending) ||
			parsed.pending.length > MAX_ARTIFACT_ENTRIES_PER_PASS
		)
			return undefined;
		const pending: DiscoveryFrame[] = [];
		for (const frame of parsed.pending) {
			if (!frame || typeof frame !== "object") return undefined;
			const candidate = frame as {
				directory?: unknown;
				snapshot?: unknown;
				offset?: unknown;
				artifact?: unknown;
			};
			if (!safeDiscoveryDirectory(candidate.directory)) return undefined;
			if (candidate.snapshot !== undefined && !safeDiscoverySnapshot(candidate.snapshot)) return undefined;
			if (
				candidate.offset !== undefined &&
				(typeof candidate.offset !== "number" || !Number.isSafeInteger(candidate.offset) || candidate.offset < 0)
			)
				return undefined;
			if (candidate.artifact !== undefined && candidate.artifact !== true) return undefined;
			if (candidate.artifact && (candidate.snapshot !== undefined || candidate.offset !== undefined))
				return undefined;
			if (candidate.offset !== undefined && candidate.snapshot === undefined) return undefined;
			pending.push({
				directory: candidate.directory,
				...(typeof candidate.snapshot === "string" ? { snapshot: candidate.snapshot } : {}),
				...(typeof candidate.offset === "number" ? { offset: candidate.offset } : {}),
				...(candidate.artifact === true ? { artifact: true as const } : {}),
			});
		}
		return pending;
	} catch {
		return undefined;
	}
}

async function writeDiscoveryFrontier(root: string, pending: readonly DiscoveryFrame[]): Promise<void> {
	const cursor = path.join(root, DISCOVERY_CURSOR_FILE);
	const temporary = path.join(root, `.${DISCOVERY_CURSOR_FILE}.${randomUUID()}.tmp`);
	try {
		const serialized = `${JSON.stringify({ version: 2, pending })}\n`;
		if (Buffer.byteLength(serialized, "utf8") > MAX_DISCOVERY_CURSOR_BYTES) {
			throw new Error("Artifact discovery frontier exceeded its persistence bound.");
		}
		await fs.promises.writeFile(temporary, serialized, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		await fs.promises.rename(temporary, cursor);
	} finally {
		await fs.promises.unlink(temporary).catch(() => undefined);
	}
}

function resolveDiscoveryFrame(root: string, frame: DiscoveryFrame): string | undefined {
	const candidate = path.resolve(root, frame.directory);
	const relative = path.relative(root, candidate);
	if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
	return candidate;
}

async function findSessionArtifactDirectories(
	root: string,
	maximum: number,
	now: number,
	budget: ArtifactCleanupBudget,
): Promise<{ directories: string[]; complete: boolean }> {
	if (!(await ownedDirectory(root))) return { directories: [], complete: true };
	const pending = (await readDiscoveryFrontier(root)) ?? [{ directory: "." }];
	const directories: string[] = [];
	let snapshotDirectory: string;
	try {
		snapshotDirectory = await ensureDiscoverySnapshotDirectory(root);
	} catch {
		return { directories: [], complete: false };
	}
	while (pending.length > 0 && directories.length < maximum && budget.entries < budget.maxEntries) {
		const frame = pending.pop();
		if (!frame) break;
		const directory = resolveDiscoveryFrame(root, frame);
		if (!directory || !(await ownedDirectory(directory))) continue;
		if (frame.artifact) {
			if (!(await cleanupMarkerIsFresh(directory, now))) directories.push(directory);
			continue;
		}
		let activeFrame = frame;
		try {
			if (!activeFrame.snapshot) {
				const snapshot = `${randomUUID()}.jsonl`;
				const target = resolveDiscoverySnapshot(snapshotDirectory, snapshot);
				if (!target) throw new Error("Invalid artifact discovery snapshot path.");
				await buildNameSnapshot(
					directory,
					target,
					(entry) => entry.name !== DISCOVERY_SNAPSHOT_DIRECTORY && entry.isDirectory() && !entry.isSymbolicLink(),
				);
				activeFrame = { directory: frame.directory, snapshot, offset: 0 };
			}
		} catch {
			pending.push({ directory: frame.directory });
			break;
		}
		if (budget.entries >= budget.maxEntries) {
			pending.push(activeFrame);
			break;
		}
		const snapshot = activeFrame.snapshot;
		const snapshotPath = snapshot ? resolveDiscoverySnapshot(snapshotDirectory, snapshot) : undefined;
		if (!snapshot || !snapshotPath) {
			pending.push({ directory: frame.directory });
			break;
		}
		let page: NameSnapshotPage;
		try {
			page = await readNameSnapshotPage(
				snapshotPath,
				activeFrame.offset ?? 0,
				Math.min(SCAN_YIELD_INTERVAL, Math.max(0, budget.maxEntries - budget.entries)),
			);
		} catch {
			await removeDiscoverySnapshot(snapshotDirectory, snapshot);
			pending.push({ directory: frame.directory });
			break;
		}
		budget.entries += page.records;
		const childFrames: DiscoveryFrame[] = [];
		for (const name of page.names) {
			const candidate = path.join(directory, name);
			if (!(await ownedDirectory(candidate))) continue;
			const relative = path.relative(root, candidate);
			if (!safeDiscoveryDirectory(relative)) continue;
			childFrames.push(
				name === ARTIFACT_DIRECTORY_NAME ? { directory: relative, artifact: true } : { directory: relative },
			);
		}
		if (!page.complete) pending.push({ directory: frame.directory, snapshot, offset: page.nextOffset });
		else await removeDiscoverySnapshot(snapshotDirectory, snapshot);
		// The frontier is a depth-first stack. Snapshot pages keep both memory and
		// persisted state bounded by width × depth without rescanning a directory.
		for (let index = childFrames.length - 1; index >= 0; index -= 1) {
			const child = childFrames[index];
			if (child) pending.push(child);
		}
	}
	const complete = pending.length === 0;
	try {
		if (complete) {
			await fs.promises.unlink(path.join(root, DISCOVERY_CURSOR_FILE)).catch(() => undefined);
			await fs.promises.rmdir(snapshotDirectory).catch(() => undefined);
		} else await writeDiscoveryFrontier(root, pending);
	} catch {
		// Losing a best-effort frontier repeats safe discovery but never broadens deletion.
	}
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
	const maxEntries = Math.max(1, options.maxEntries ?? MAX_ARTIFACT_ENTRIES_PER_PASS);
	const maxDirectories = Math.min(
		Math.max(0, options.maxDirectories ?? MAX_ARTIFACT_DIRECTORIES_PER_PASS),
		maxEntries,
	);
	const discoveryBudget: ArtifactCleanupBudget = {
		entries: 0,
		maxEntries,
	};
	const sessionsRoot = options.sessionsRoot ?? path.join(getAgentDir(), "sessions");
	const discovered = await findSessionArtifactDirectories(sessionsRoot, maxDirectories, now, discoveryBudget);
	const tempArtifactsDir = options.tempArtifactsDir ?? TEMP_ARTIFACTS_DIR;
	let directoriesInspected = 0;
	let filesRemoved = 0;
	let bytesReclaimed = 0;
	let scanComplete = discovered.complete;
	let sessionEntriesRemaining = maxEntries;
	for (let index = 0; index < discovered.directories.length; index += 1) {
		const directory = discovered.directories[index];
		if (!directory) continue;
		if (!(await ownedDirectory(directory))) continue;
		directoriesInspected += 1;
		const directoriesRemaining = discovered.directories.length - index;
		const quota = Math.max(1, Math.floor(sessionEntriesRemaining / directoriesRemaining));
		const localBudget: ArtifactCleanupBudget = { entries: 0, maxEntries: quota };
		const cleaned = await cleanArtifactDirectory(directory, cutoff, now, localBudget);
		sessionEntriesRemaining = Math.max(0, sessionEntriesRemaining - localBudget.entries);
		filesRemoved += cleaned.filesRemoved;
		bytesReclaimed += cleaned.bytesReclaimed;
		if (!cleaned.complete) scanComplete = false;
	}
	// Temp artifacts receive an independent bounded pass. A large or retained
	// session directory therefore cannot starve terminal temp artifacts forever.
	if (await ownedDirectory(tempArtifactsDir)) {
		directoriesInspected += 1;
		const tempBudget: ArtifactCleanupBudget = { entries: 0, maxEntries };
		const cleaned = await cleanArtifactDirectory(tempArtifactsDir, cutoff, now, tempBudget);
		filesRemoved += cleaned.filesRemoved;
		bytesReclaimed += cleaned.bytesReclaimed;
		if (!cleaned.complete) scanComplete = false;
	}
	return { directoriesInspected, filesRemoved, bytesReclaimed, scanComplete };
}

function eventLoopTurn(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
