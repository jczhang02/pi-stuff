import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import { filterByCwd, type SessionFileMeta, scanAllSessionDirs, scanSessionDir } from "./scanner-native.js";
import { loadSessionHeaders } from "./session-reader-native.js";

type SessionListProgress = (loaded: number, total: number) => void;

const SESSION_BATCH_SIZE = 50;

function byModified(left: SessionInfo, right: SessionInfo): number {
	return right.modified.getTime() - left.modified.getTime();
}

function loadSessions(
	metas: readonly SessionFileMeta[],
	onProgress?: SessionListProgress,
	cwd?: string,
): Effect.Effect<SessionInfo[], Error> {
	return Effect.gen(function* () {
		const sessions: SessionInfo[] = [];
		for (let index = 0; index < metas.length; index += SESSION_BATCH_SIZE) {
			const batch = metas.slice(index, index + SESSION_BATCH_SIZE);
			const loaded = yield* Effect.try({
				try: () => loadSessionHeaders(batch),
				catch: () => new Error("Could not scan Sessions."),
			});
			sessions.push(...(cwd === undefined ? loaded : filterByCwd(loaded, cwd)));
			onProgress?.(Math.min(index + batch.length, metas.length), metas.length);
			if (index + batch.length < metas.length) yield* Effect.sleep(0);
		}
		return sessions.sort(byModified);
	});
}

export function loadCurrentSessions(
	sessionDir: string,
	cwd: string,
	onProgress?: SessionListProgress,
): Effect.Effect<SessionInfo[], Error> {
	return Effect.suspend(() => loadSessions(scanSessionDir(sessionDir), onProgress, cwd));
}

export function loadAllSessions(
	sessionDir: string,
	usesDefaultSessionDir: boolean,
	onProgress?: SessionListProgress,
): Effect.Effect<SessionInfo[], Error> {
	return Effect.suspend(() => {
		const metas = usesDefaultSessionDir ? scanAllSessionDirs() : scanSessionDir(sessionDir);
		return loadSessions(metas, onProgress);
	});
}
