import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SessionFileMeta, SessionHeader } from "./session.js";

const DEFAULT_SESSIONS_DIR = join(getAgentDir(), "sessions");

/**
 * Scan ALL session directories under the root (~/.pi/agent/sessions/).
 * Each subdirectory contains .jsonl files for a specific cwd.
 */
export function scanAllSessionDirs(sessionsDir: string = DEFAULT_SESSIONS_DIR): SessionFileMeta[] {
	const results: SessionFileMeta[] = [];
	let dirs: string[];

	try {
		dirs = readdirSync(sessionsDir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);
	} catch {
		return results;
	}

	for (const dir of dirs) {
		const subDir = join(sessionsDir, dir);
		let files: string[];
		try {
			files = readdirSync(subDir);
		} catch {
			continue;
		}
		for (const file of files) {
			if (!file.endsWith(".jsonl")) continue;
			const path = join(subDir, file);
			try {
				const stat = statSync(path);
				results.push({
					path,
					mtimeMs: stat.mtimeMs,
					size: stat.size,
				});
			} catch {
				// File disappeared between readdir and stat, skip
			}
		}
	}

	return results;
}

/**
 * Scan only the session directory that corresponds to a given cwd.
 * Matches pi's built-in SessionManager.list() behavior.
 */
export function scanSessionDir(sessionDir: string): SessionFileMeta[] {
	const results: SessionFileMeta[] = [];

	let files: string[];
	try {
		files = readdirSync(sessionDir);
	} catch {
		return results;
	}

	for (const file of files) {
		if (!file.endsWith(".jsonl")) continue;
		const path = join(sessionDir, file);
		try {
			const stat = statSync(path);
			results.push({
				path,
				mtimeMs: stat.mtimeMs,
				size: stat.size,
			});
		} catch {
			// File disappeared
		}
	}

	return results;
}

export function sortByModified(sessions: SessionHeader[]): SessionHeader[] {
	return sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

export function sortByModifiedDesc(metas: SessionFileMeta[]): SessionFileMeta[] {
	return metas.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Filter sessions by cwd, matching pi's sessionCwdMatches behavior:
 * resolves both paths before comparing so symlinks don't cause mismatches.
 */
export function filterByCwd(sessions: SessionHeader[], cwd: string): SessionHeader[] {
	const resolvedCwd = resolve(cwd);
	return sessions.filter((s) => {
		if (!s.cwd) return false;
		return resolve(s.cwd) === resolvedCwd;
	});
}

// Process-lifetime memo of realpath results. canonicalizePath is called
// 2–3× per session per tree build (buildSessionTree) and once per visible row
// per render (isCurrentSessionPath), and the tree is rebuilt on every keystroke
// in threaded mode. realpathSync is a syscall (~µs each); memoizing collapses
// thousands of syscalls per keystroke to Map lookups. This is pure memoization
// (no persistent file, no staleness to manage) — realpath of a path is stable
// for the process lifetime unless a symlink target changes, which doesn't
// happen to session files under ~/.pi/agent/sessions. Call
// clearCanonicalPathCache() to reset (used by tests/benches).
const canonicalPathCache = new Map<string, string>();

/**
 * Canonicalize a file path by resolving symlinks, memoized per process.
 * Matches pi-core's canonicalizePath behavior (realpathSync with fallback).
 */
export function canonicalizePath(path: string): string {
	const cached = canonicalPathCache.get(path);
	if (cached !== undefined) return cached;
	let result: string;
	try {
		result = realpathSync(path);
	} catch {
		result = path;
	}
	canonicalPathCache.set(path, result);
	return result;
}

/** Clear the canonicalizePath memo. Intended for tests/benches. */
export function clearCanonicalPathCache(): void {
	canonicalPathCache.clear();
}
