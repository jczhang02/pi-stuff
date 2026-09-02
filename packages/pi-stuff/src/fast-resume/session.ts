export const FORWARD_CHUNK_BYTES = 16 * 1024;
export const TAIL_WINDOW_BYTES = 32 * 1024;
export const INITIAL_SESSION_COUNT = 30;
export const SESSION_BATCH_SIZE = 50;

export interface SessionFileMeta {
	readonly mtimeMs: number;
	readonly path: string;
	readonly size: number;
}

export interface SessionHeader {
	_fwdConsumedBytes?: number;
	_fwdReachedEof?: boolean;
	_searchText?: string;
	canonicalPath?: string;
	created: Date;
	cwd: string;
	firstMessage: string;
	id: string;
	messageCount: number;
	modified: Date;
	name?: string;
	parentSessionCanonicalPath?: string;
	parentSessionPath?: string;
	path: string;
}

export interface CurrentSessionScan {
	readonly all: readonly SessionFileMeta[];
	readonly initial: readonly SessionHeader[];
	readonly remaining: readonly SessionFileMeta[];
}

export function sortMetasByModified(metas: readonly SessionFileMeta[]): SessionFileMeta[] {
	return [...metas].sort((left, right) => right.mtimeMs - left.mtimeMs);
}

export function sortSessionsByModified(sessions: readonly SessionHeader[]): SessionHeader[] {
	return [...sessions].sort((left, right) => right.modified.getTime() - left.modified.getTime());
}
