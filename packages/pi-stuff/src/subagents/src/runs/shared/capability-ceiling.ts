import { Buffer } from "node:buffer";
import { type JsonValue, parseJsonValue } from "../../../../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeObject, isRuntimeString } from "../../../../shared/runtime-type.js";

export const SUBAGENT_CAPABILITY_CEILING_VERSION = 1 as const;
export const SUBAGENT_CAPABILITY_CEILING_REGISTRY_KEY = "pi-subagents.capability-ceiling.v1";
export const SUBAGENT_CAPABILITY_CEILING_ENV = "PI_SUBAGENT_CAPABILITY_CEILING_V1";

export type SubagentCapabilityCeiling =
	| { allowedTools: readonly string[]; denyExtensions?: boolean }
	| { allowedTools?: readonly string[]; denyExtensions: boolean };

export interface ResolvedSubagentCapabilityCeiling {
	version: typeof SUBAGENT_CAPABILITY_CEILING_VERSION;
	allowedTools?: string[];
	denyExtensions: boolean;
	sources: string[];
}

export interface SubagentCapabilityAudit {
	ceiling: ResolvedSubagentCapabilityCeiling;
	requestedTools?: string[];
	effectiveTools: string[];
	removedTools: string[];
	internalTools: string[];
	extensionsDenied: boolean;
	removedExtensionCount: number;
	requestedMcpToolCount: number;
	effectiveMcpTools: string[];
}

export interface RegisterSubagentCapabilityCeilingOptions {
	sessionId: string;
	source: string;
	ceiling: SubagentCapabilityCeiling;
}

export interface SubagentCapabilityCeilingHandle {
	update(ceiling: SubagentCapabilityCeiling): void;
	dispose(): void;
}

type Registration = { source: string; ceiling: ResolvedSubagentCapabilityCeiling };
type Registry = Map<string, Map<symbol, Registration>>;

function registry(): Registry {
	const key = Symbol.for(SUBAGENT_CAPABILITY_CEILING_REGISTRY_KEY);
	const existing = Object.getOwnPropertyDescriptor(globalThis, key)?.value;
	if (existing instanceof Map) {
		// SAFETY: this package-owned symbol slot is initialized below only with the nested capability Registry.
		return existing as Registry;
	}
	const created: Registry = new Map();
	Object.defineProperty(globalThis, key, { configurable: true, value: created, writable: true });
	return created;
}

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function validateText<Value>(value: Value, field: string): string {
	if (
		!isRuntimeString(value) ||
		!value.trim() ||
		hasControlCharacter(value) ||
		Buffer.byteLength(value.trim(), "utf8") > 256
	) {
		throw new Error(
			`Invalid capability ceiling ${field}; expected a non-empty string without control characters (max 256 UTF-8 bytes).`,
		);
	}
	return value.trim();
}

function normalizeCeiling<Ceiling>(ceiling: Ceiling): ResolvedSubagentCapabilityCeiling {
	if (!ceiling || !isRuntimeObject(ceiling) || Array.isArray(ceiling))
		throw new Error("Invalid capability ceiling; expected an object.");
	const hasAllowedTools = Object.hasOwn(ceiling, "allowedTools");
	const hasDenyExtensions = Object.hasOwn(ceiling, "denyExtensions");
	if (!hasAllowedTools && !hasDenyExtensions)
		throw new Error("Invalid capability ceiling; expected allowedTools or denyExtensions.");
	const denyExtensions = "denyExtensions" in ceiling ? ceiling.denyExtensions : undefined;
	if (hasDenyExtensions && !isRuntimeBoolean(denyExtensions))
		throw new Error("Invalid capability ceiling denyExtensions; expected a boolean.");
	let allowedTools: string[] | undefined;
	if (hasAllowedTools) {
		const rawAllowedTools = "allowedTools" in ceiling ? ceiling.allowedTools : undefined;
		if (!Array.isArray(rawAllowedTools))
			throw new Error("Invalid capability ceiling allowedTools; expected an array.");
		if (rawAllowedTools.length > 256)
			throw new Error("Invalid capability ceiling allowedTools; expected at most 256 names.");
		allowedTools = [
			...new Set(
				rawAllowedTools.map((tool) => {
					const name = validateText(tool, "allowedTools entry");
					if (!/^[A-Za-z0-9_.:-]+$/u.test(name))
						throw new Error(`Invalid capability ceiling allowedTools entry '${name}'.`);
					if (Buffer.byteLength(name, "utf8") > 128)
						throw new Error(`Invalid capability ceiling allowedTools entry '${name}'; max 128 UTF-8 bytes.`);
					return name;
				}),
			),
		].sort();
	}
	const normalized: ResolvedSubagentCapabilityCeiling = {
		version: SUBAGENT_CAPABILITY_CEILING_VERSION,
		denyExtensions: denyExtensions === true,
		sources: [],
	};
	if (allowedTools) normalized.allowedTools = allowedTools;
	return normalized;
}

export function parseSubagentCapabilityCeiling<Value>(
	value: Value,
	field = "capability ceiling",
): ResolvedSubagentCapabilityCeiling {
	if (!value || !isRuntimeObject(value) || Array.isArray(value))
		throw new Error(`Invalid ${field}; expected an object.`);
	if (!("version" in value) || value.version !== SUBAGENT_CAPABILITY_CEILING_VERSION)
		throw new Error(`Invalid ${field} version.`);
	const normalized = normalizeCeiling(value);
	const sources = "sources" in value ? value.sources : undefined;
	if (!Array.isArray(sources) || sources.some((source) => !isRuntimeString(source)))
		throw new Error(`Invalid ${field} sources; expected an array of strings.`);
	normalized.sources = [...new Set(sources.map((source) => validateText(source, `${field} source`)))].sort();
	return normalized;
}

export function registerSubagentCapabilityCeiling(
	options: RegisterSubagentCapabilityCeilingOptions,
): SubagentCapabilityCeilingHandle {
	const sessionId = validateText(options.sessionId, "sessionId");
	const source = validateText(options.source, "source");
	let normalized = normalizeCeiling(options.ceiling);
	const token = Symbol(source);
	const store = registry();
	let registrations = store.get(sessionId);
	if (!registrations) {
		registrations = new Map();
		store.set(sessionId, registrations);
	}
	const setRegistration = () => {
		normalized = normalizeCeiling(normalized);
		normalized.sources = [source];
		registrations.set(token, { source, ceiling: normalized });
	};
	setRegistration();
	let disposed = false;
	return {
		update(ceiling) {
			if (disposed) throw new Error("Cannot update a disposed capability ceiling handle.");
			normalized = normalizeCeiling(ceiling);
			normalized.sources = [source];
			registrations.set(token, { source, ceiling: normalized });
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			registrations.delete(token);
			if (registrations.size === 0) store.delete(sessionId);
		},
	};
}

export function intersectSubagentCapabilityCeilings(
	...ceilings: Array<ResolvedSubagentCapabilityCeiling | undefined>
): ResolvedSubagentCapabilityCeiling | undefined {
	const active = ceilings.filter((ceiling): ceiling is ResolvedSubagentCapabilityCeiling => ceiling !== undefined);
	if (active.length === 0) return undefined;
	const definedLists = active
		.filter((ceiling) => ceiling.allowedTools !== undefined)
		.map((ceiling) => new Set(ceiling.allowedTools));
	let allowedTools: string[] | undefined;
	const firstDefinedList = definedLists.at(0);
	if (firstDefinedList) {
		allowedTools = [...firstDefinedList].filter((tool) => definedLists.every((list) => list.has(tool))).sort();
	}
	const intersection: ResolvedSubagentCapabilityCeiling = {
		version: SUBAGENT_CAPABILITY_CEILING_VERSION,
		denyExtensions: active.some((ceiling) => ceiling.denyExtensions),
		sources: [...new Set(active.flatMap((ceiling) => ceiling.sources))].sort(),
	};
	if (allowedTools) intersection.allowedTools = allowedTools;
	return intersection;
}

export function resolveSubagentCapabilityCeiling(
	sessionId: string | undefined,
	inherited?: ResolvedSubagentCapabilityCeiling,
): ResolvedSubagentCapabilityCeiling | undefined {
	const active: ResolvedSubagentCapabilityCeiling[] = [];
	if (sessionId) {
		const registrations = registry().get(sessionId);
		if (registrations) active.push(...Array.from(registrations.values(), ({ ceiling }) => ceiling));
	}
	return intersectSubagentCapabilityCeilings(inherited, ...active);
}

export function resolveCurrentSubagentCapabilityCeiling(
	sessionId: string | undefined,
): ResolvedSubagentCapabilityCeiling | undefined {
	return resolveSubagentCapabilityCeiling(
		sessionId,
		decodeSubagentCapabilityCeiling(process.env[SUBAGENT_CAPABILITY_CEILING_ENV]),
	);
}

export function encodeSubagentCapabilityCeiling(
	ceiling: ResolvedSubagentCapabilityCeiling | undefined,
): string | undefined {
	if (!ceiling) return undefined;
	return Buffer.from(JSON.stringify(ceiling), "utf8").toString("base64url");
}

export function decodeSubagentCapabilityCeiling(
	value: string | undefined,
): ResolvedSubagentCapabilityCeiling | undefined {
	if (value === undefined || value === "") return undefined;
	let parsed: JsonValue;
	try {
		parsed = parseJsonValue(Buffer.from(value, "base64url").toString("utf8"));
	} catch (error) {
		throw new Error(
			`Invalid inherited capability ceiling: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (
		!parsed ||
		!isRuntimeObject(parsed) ||
		Array.isArray(parsed) ||
		!("version" in parsed) ||
		parsed.version !== SUBAGENT_CAPABILITY_CEILING_VERSION
	) {
		throw new Error("Invalid inherited capability ceiling version.");
	}
	return parseSubagentCapabilityCeiling(parsed, "inherited capability ceiling");
}
