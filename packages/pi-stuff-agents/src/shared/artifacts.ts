import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { type ArtifactDirPreference, type ArtifactPaths, TEMP_ARTIFACTS_DIR } from "./types.ts";
import { getAgentDir } from "./utils.ts";

const CLEANUP_MARKER_FILE = ".last-cleanup";
const CLEANUP_CURSOR_FILE = ".cleanup-cursor";
const DISCOVERY_CURSOR_FILE = ".artifact-cleanup-frontier";
const PROJECT_ARTIFACT_ROOT = ".pi-subagents";
const ARTIFACT_DIRECTORY_NAME = "subagent-artifacts";
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MAX_ARTIFACT_DIRECTORIES_PER_PASS = 5_000;
const MAX_ARTIFACT_ENTRIES_PER_PASS = 50_000;
const SCAN_YIELD_INTERVAL = 32;
const DISCOVERY_PAGE_SIZE = 32;
const MAX_DISCOVERY_CURSOR_BYTES = 1024 * 1024;
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

function compareEntryNames(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function pushMaxHeap(heap: string[], value: string): void {
	heap.push(value);
	for (let index = heap.length - 1; index > 0; ) {
		const parent = Math.floor((index - 1) / 2);
		const parentValue = heap[parent];
		if (parentValue === undefined || compareEntryNames(parentValue, value) >= 0) break;
		heap[index] = parentValue;
		heap[parent] = value;
		index = parent;
	}
}

function replaceMaxHeapRoot(heap: string[], value: string): void {
	if (heap.length === 0) return;
	heap[0] = value;
	for (let index = 0; ; ) {
		const left = index * 2 + 1;
		const right = left + 1;
		let largest = index;
		if (
			left < heap.length &&
			heap[left] !== undefined &&
			heap[largest] !== undefined &&
			compareEntryNames(heap[left], heap[largest]) > 0
		)
			largest = left;
		if (
			right < heap.length &&
			heap[right] !== undefined &&
			heap[largest] !== undefined &&
			compareEntryNames(heap[right], heap[largest]) > 0
		)
			largest = right;
		if (largest === index) break;
		const current = heap[index];
		const next = heap[largest];
		if (current === undefined || next === undefined) break;
		heap[index] = next;
		heap[largest] = current;
		index = largest;
	}
}

/**
 * Select the next lexical page with O(limit) memory. The directory stream is
 * yielded regularly, so even a legacy flat directory much larger than one
 * mutation batch cannot monopolize Pi's event loop or be fully materialized.
 */
async function lexicalDirectoryPage(
	directory: string,
	after: string | undefined,
	limit: number,
	accept: (entry: fs.Dirent) => boolean,
): Promise<{ names: string[]; more: boolean }> {
	if (limit <= 0) return { names: [], more: true };
	const heap: string[] = [];
	let matches = 0;
	let scanned = 0;
	const entries = await fs.promises.opendir(directory);
	for await (const entry of entries) {
		scanned += 1;
		if (scanned % SCAN_YIELD_INTERVAL === 0) await eventLoopTurn();
		if ((after !== undefined && compareEntryNames(entry.name, after) <= 0) || !accept(entry)) continue;
		matches += 1;
		if (heap.length < limit) pushMaxHeap(heap, entry.name);
		else if (heap[0] !== undefined && compareEntryNames(entry.name, heap[0]) < 0)
			replaceMaxHeapRoot(heap, entry.name);
	}
	const names = heap.sort(compareEntryNames);
	return { names, more: matches > names.length };
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
	let lastProcessed: string | undefined;
	let complete = false;
	try {
		const cursor = await readCleanupCursor(directory);
		const page = await lexicalDirectoryPage(
			directory,
			cursor,
			Math.max(0, budget.maxEntries - budget.entries),
			(entry) =>
				entry.name !== CLEANUP_MARKER_FILE &&
				entry.name !== CLEANUP_CURSOR_FILE &&
				artifactBaseName(entry.name) !== undefined,
		);
		for (const name of page.names) {
			budget.entries += 1;
			lastProcessed = name;
			const base = artifactBaseName(name);
			if (base) {
				const removed = await removeTerminalArtifactGroup(directory, base, cutoff);
				filesRemoved += removed.filesRemoved;
				bytesReclaimed += removed.bytesReclaimed;
			}
		}
		complete = !page.more;
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

interface DiscoveryFrame {
	readonly directory: string;
	readonly after?: string;
}

interface DiscoveryFrontier {
	readonly version: 1;
	readonly pending: DiscoveryFrame[];
}

function safeDiscoveryDirectory(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.length > 4_096 || path.isAbsolute(value)) return false;
	return !value.split(/[\\/]+/u).some((part) => part === ".." || part.includes("\0"));
}

async function readDiscoveryFrontier(root: string): Promise<DiscoveryFrame[] | undefined> {
	try {
		const cursorPath = path.join(root, DISCOVERY_CURSOR_FILE);
		const stat = await fs.promises.lstat(cursorPath);
		if (!ownedRegularFile(stat) || stat.size > MAX_DISCOVERY_CURSOR_BYTES) return undefined;
		const parsed = JSON.parse(await fs.promises.readFile(cursorPath, "utf8")) as Partial<DiscoveryFrontier>;
		if (
			parsed.version !== 1 ||
			!Array.isArray(parsed.pending) ||
			parsed.pending.length > MAX_ARTIFACT_ENTRIES_PER_PASS
		)
			return undefined;
		const pending: DiscoveryFrame[] = [];
		for (const frame of parsed.pending) {
			if (!frame || typeof frame !== "object") return undefined;
			const candidate = frame as { directory?: unknown; after?: unknown };
			if (!safeDiscoveryDirectory(candidate.directory)) return undefined;
			if (candidate.after !== undefined && (typeof candidate.after !== "string" || candidate.after.length > 4_096))
				return undefined;
			pending.push({
				directory: candidate.directory,
				...(typeof candidate.after === "string" && candidate.after ? { after: candidate.after } : {}),
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
		const serialized = `${JSON.stringify({ version: 1, pending })}\n`;
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
	while (pending.length > 0 && directories.length < maximum && budget.entries < budget.maxEntries) {
		const frame = pending.pop();
		if (!frame) break;
		const directory = resolveDiscoveryFrame(root, frame);
		if (!directory || !(await ownedDirectory(directory))) continue;
		let page: { names: string[]; more: boolean };
		try {
			page = await lexicalDirectoryPage(
				directory,
				frame.after,
				Math.min(DISCOVERY_PAGE_SIZE, Math.max(0, budget.maxEntries - budget.entries)),
				(entry) => entry.isDirectory() && !entry.isSymbolicLink(),
			);
		} catch {
			continue;
		}
		let lastProcessed: string | undefined;
		const childFrames: DiscoveryFrame[] = [];
		for (const name of page.names) {
			if (directories.length >= maximum || budget.entries >= budget.maxEntries) break;
			budget.entries += 1;
			lastProcessed = name;
			const candidate = path.join(directory, name);
			if (!(await ownedDirectory(candidate))) continue;
			if (name === ARTIFACT_DIRECTORY_NAME) {
				// Completed batches carry a fresh marker. Skipping them lets later
				// interactions advance through a tree larger than one bounded pass.
				if (!(await cleanupMarkerIsFresh(candidate, now))) directories.push(candidate);
			} else {
				const relative = path.relative(root, candidate);
				if (safeDiscoveryDirectory(relative)) childFrames.push({ directory: relative });
			}
		}
		if (page.more || (page.names.length > 0 && lastProcessed !== page.names.at(-1))) {
			pending.push({ directory: frame.directory, ...(lastProcessed ? { after: lastProcessed } : {}) });
		}
		// The frontier is a depth-first stack. Limiting each lexical page and pushing
		// children in reverse order keeps persisted state bounded by width × depth
		// instead of accumulating an entire broad session tree in memory.
		for (let index = childFrames.length - 1; index >= 0; index -= 1) {
			const child = childFrames[index];
			if (child) pending.push(child);
		}
	}
	const complete = pending.length === 0;
	try {
		if (complete) await fs.promises.unlink(path.join(root, DISCOVERY_CURSOR_FILE)).catch(() => undefined);
		else await writeDiscoveryFrontier(root, pending);
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
