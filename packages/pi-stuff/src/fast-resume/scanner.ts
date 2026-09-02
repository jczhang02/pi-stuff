import * as Effect from "effect/Effect";
import {
	canonicalizePath,
	clearCanonicalPathCache,
	filterByCwd,
	scanAllSessionDirs,
	scanSessionDir,
	sortByModified,
	sortByModifiedDesc,
} from "./scanner-native.js";
import { type CurrentSessionScan, INITIAL_SESSION_COUNT, type SessionFileMeta, type SessionHeader } from "./session.js";
import { loadSessionHeaders, loadSessionHeadersForward, resolveSessionNamesDeferred } from "./session-reader-native.js";

function decorate(headers: SessionHeader[]): SessionHeader[] {
	for (const header of headers) {
		header.canonicalPath = canonicalizePath(header.path);
		if (header.parentSessionPath) {
			header.parentSessionCanonicalPath = canonicalizePath(header.parentSessionPath);
		}
	}
	return headers;
}

function currentScanNative(sessionDir: string, cwd: string, _usesDefaultSessionDir: boolean): CurrentSessionScan {
	const all = sortByModifiedDesc(scanSessionDir(sessionDir));
	const initial: SessionHeader[] = [];
	let consumed = 0;
	while (initial.length < INITIAL_SESSION_COUNT && consumed < all.length) {
		const count = INITIAL_SESSION_COUNT - initial.length;
		const batch = all.slice(consumed, consumed + count);
		consumed += batch.length;
		initial.push(...filterByCwd(decorate(loadSessionHeadersForward(batch)), cwd));
	}
	return { all, initial: sortByModified(initial), remaining: all.slice(consumed) };
}

export function scanCurrentSessions(
	sessionDir: string,
	cwd: string,
	usesDefaultSessionDir: boolean,
): Effect.Effect<CurrentSessionScan, Error> {
	return Effect.try({
		try: () => currentScanNative(sessionDir, cwd, usesDefaultSessionDir),
		catch: () => new Error("Could not scan Sessions."),
	});
}

export function scanAllSessionMetas(
	sessionDir: string,
	usesDefaultSessionDir: boolean,
): Effect.Effect<readonly SessionFileMeta[], Error> {
	return Effect.try({
		try: () => sortByModifiedDesc(usesDefaultSessionDir ? scanAllSessionDirs() : scanSessionDir(sessionDir)),
		catch: () => new Error("Could not scan Sessions."),
	});
}

export function loadSessionBatch(
	metas: readonly SessionFileMeta[],
	cwd?: string,
): Effect.Effect<SessionHeader[], Error> {
	return Effect.try({
		try: () => {
			const headers = decorate(loadSessionHeadersForward([...metas]));
			return cwd === undefined ? headers : filterByCwd(headers, cwd);
		},
		catch: () => new Error("Could not scan Sessions."),
	});
}

export function loadCompleteSessions(
	metas: readonly SessionFileMeta[],
	cwd?: string,
): Effect.Effect<SessionHeader[], Error> {
	return Effect.try({
		try: () => {
			const headers = decorate(loadSessionHeaders([...metas]));
			return sortByModified(cwd === undefined ? headers : filterByCwd(headers, cwd));
		},
		catch: () => new Error("Could not scan Sessions."),
	});
}

export function resolveDeferredSessionNames(
	headers: readonly SessionHeader[],
	metasByPath: ReadonlyMap<string, SessionFileMeta>,
): Effect.Effect<ReadonlyMap<string, string | undefined>, Error> {
	return Effect.try({
		try: () => resolveSessionNamesDeferred([...headers], new Map(metasByPath)),
		catch: () => new Error("Could not scan Sessions."),
	});
}

export function canonicalSessionPath(path: string): Effect.Effect<string, Error> {
	return Effect.try({ try: () => canonicalizePath(path), catch: () => new Error("Could not scan Sessions.") });
}

export function resetCanonicalSessionPaths(): Effect.Effect<void> {
	return Effect.sync(clearCanonicalPathCache);
}
