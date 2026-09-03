import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir, type SessionInfo } from "@earendil-works/pi-coding-agent";

export interface SessionFileMeta {
	readonly mtimeMs: number;
	readonly path: string;
	readonly size: number;
}

const DEFAULT_SESSIONS_DIR = join(getAgentDir(), "sessions");

function sessionFileMeta(directory: string, file: string): SessionFileMeta | undefined {
	if (!file.endsWith(".jsonl")) return undefined;
	const path = join(directory, file);
	try {
		const stat = statSync(path);
		return { mtimeMs: stat.mtimeMs, path, size: stat.size };
	} catch {
		return undefined;
	}
}

export function scanAllSessionDirs(sessionsDir: string = DEFAULT_SESSIONS_DIR): SessionFileMeta[] {
	let directories: string[];
	try {
		directories = readdirSync(sessionsDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
	const results: SessionFileMeta[] = [];
	for (const name of directories) results.push(...scanSessionDir(join(sessionsDir, name)));
	return results;
}

export function scanSessionDir(sessionDir: string): SessionFileMeta[] {
	let files: string[];
	try {
		files = readdirSync(sessionDir);
	} catch {
		return [];
	}
	return files.flatMap((file) => {
		const meta = sessionFileMeta(sessionDir, file);
		return meta ? [meta] : [];
	});
}

export function filterByCwd(sessions: SessionInfo[], cwd: string): SessionInfo[] {
	const expected = resolve(cwd);
	return sessions.filter((session) => Boolean(session.cwd) && resolve(session.cwd) === expected);
}
