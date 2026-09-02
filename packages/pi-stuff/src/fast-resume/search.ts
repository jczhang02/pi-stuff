import { fuzzyMatch } from "@earendil-works/pi-tui";
import type { SessionHeader } from "./session.js";

export type PickerScope = "current" | "all";
export type SearchTokenKind = "fuzzy" | "phrase";
export type SortMode = "threaded" | "recent" | "relevance";
export type NameFilter = "all" | "named";

export interface SearchToken {
	readonly kind: SearchTokenKind;
	readonly value: string;
}

export interface ParsedSearch {
	readonly error?: string;
	readonly mode: "tokens" | "regex";
	readonly regex: RegExp | null;
	readonly tokens: readonly SearchToken[];
}

export interface MatchResult {
	readonly matches: boolean;
	readonly score: number;
}

export interface SessionTreeNode {
	readonly children: SessionTreeNode[];
	readonly session: SessionHeader;
}

export interface FlatSessionNode {
	readonly ancestorContinues: readonly boolean[];
	readonly depth: number;
	readonly isLast: boolean;
	readonly session: SessionHeader;
}

function normalized(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function sessionSearchText(session: SessionHeader): string {
	if (session._searchText !== undefined) return session._searchText;
	const text = [session.id, session.name ?? "", session.firstMessage, session.cwd].join(" ");
	session._searchText = text;
	return text;
}

export function invalidateSessionSearchText(session: SessionHeader): void {
	delete session._searchText;
}

function plainTokens(query: string): SearchToken[] {
	return query
		.split(/\s+/)
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => ({ kind: "fuzzy" as const, value }));
}

export function parseSearchQuery(query: string): ParsedSearch {
	const trimmed = query.trim();
	if (!trimmed) return { mode: "tokens", regex: null, tokens: [] };
	if (trimmed.startsWith("re:")) {
		const pattern = trimmed.slice(3).trim();
		if (!pattern) return { error: "Empty regex", mode: "regex", regex: null, tokens: [] };
		try {
			return { mode: "regex", regex: new RegExp(pattern, "i"), tokens: [] };
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
				mode: "regex",
				regex: null,
				tokens: [],
			};
		}
	}
	const tokens: SearchToken[] = [];
	let buffer = "";
	let quoted = false;
	const flush = (kind: SearchTokenKind): void => {
		const value = buffer.trim();
		buffer = "";
		if (value) tokens.push({ kind, value });
	};
	for (const character of trimmed) {
		if (character === '"') {
			if (quoted) flush("phrase");
			else flush("fuzzy");
			quoted = !quoted;
		} else if (!quoted && /\s/.test(character)) flush("fuzzy");
		else buffer += character;
	}
	if (quoted) return { mode: "tokens", regex: null, tokens: plainTokens(trimmed) };
	flush("fuzzy");
	return { mode: "tokens", regex: null, tokens };
}

export function matchSession(session: SessionHeader, parsed: ParsedSearch): MatchResult {
	const text = sessionSearchText(session);
	if (parsed.mode === "regex") {
		if (!parsed.regex) return { matches: false, score: 0 };
		const index = text.search(parsed.regex);
		return index < 0 ? { matches: false, score: 0 } : { matches: true, score: index * 0.1 };
	}
	if (parsed.tokens.length === 0) return { matches: true, score: 0 };
	let score = 0;
	let normalizedText: string | undefined;
	for (const token of parsed.tokens) {
		if (token.kind === "phrase") {
			normalizedText ??= normalized(text);
			const phrase = normalized(token.value);
			if (!phrase) continue;
			const index = normalizedText.indexOf(phrase);
			if (index < 0) return { matches: false, score: 0 };
			score += index * 0.1;
			continue;
		}
		const match = fuzzyMatch(token.value, text);
		if (!match.matches) return { matches: false, score: 0 };
		score += match.score;
	}
	return { matches: true, score };
}

export function hasSessionName(session: SessionHeader): boolean {
	return Boolean(session.name?.trim());
}

export function filterAndSortSessions(
	sessions: readonly SessionHeader[],
	query: string,
	sortMode: SortMode,
	nameFilter: NameFilter = "all",
): SessionHeader[] {
	const candidates = nameFilter === "named" ? sessions.filter(hasSessionName) : [...sessions];
	if (!query.trim()) return candidates;
	const parsed = parseSearchQuery(query);
	if (parsed.error) return [];
	if (sortMode === "recent") return candidates.filter((session) => matchSession(session, parsed).matches);
	return candidates
		.map((session) => ({ match: matchSession(session, parsed), session }))
		.filter(({ match }) => match.matches)
		.sort((left, right) =>
			left.match.score === right.match.score
				? right.session.modified.getTime() - left.session.modified.getTime()
				: left.match.score - right.match.score,
		)
		.map(({ session }) => session);
}

export function buildSessionTree(sessions: readonly SessionHeader[]): SessionTreeNode[] {
	const nodes = new Map<string, SessionTreeNode>();
	for (const session of sessions) {
		nodes.set(session.canonicalPath ?? session.path, { children: [], session });
	}
	const roots: SessionTreeNode[] = [];
	for (const session of sessions) {
		const key = session.canonicalPath ?? session.path;
		const node = nodes.get(key);
		if (!node) continue;
		const parentKey = session.parentSessionCanonicalPath ?? session.parentSessionPath;
		const parent = parentKey ? nodes.get(parentKey) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	const sortNodes = (items: SessionTreeNode[]): void => {
		items.sort((left, right) => right.session.modified.getTime() - left.session.modified.getTime());
		for (const item of items) sortNodes(item.children);
	};
	sortNodes(roots);
	return roots;
}

export function flattenSessionTree(roots: readonly SessionTreeNode[]): FlatSessionNode[] {
	const result: FlatSessionNode[] = [];
	const visit = (
		node: SessionTreeNode,
		depth: number,
		ancestorContinues: readonly boolean[],
		isLast: boolean,
	): void => {
		result.push({ ancestorContinues, depth, isLast, session: node.session });
		for (const [index, child] of node.children.entries()) {
			visit(child, depth + 1, [...ancestorContinues, depth > 0 && !isLast], index === node.children.length - 1);
		}
	};
	for (const [index, root] of roots.entries()) visit(root, 0, [], index === roots.length - 1);
	return result;
}

export function buildTreePrefix(node: FlatSessionNode): string {
	if (node.depth === 0) return "";
	return (
		node.ancestorContinues.map((continues) => (continues ? "│  " : "   ")).join("") + (node.isLast ? "└─ " : "├─ ")
	);
}
