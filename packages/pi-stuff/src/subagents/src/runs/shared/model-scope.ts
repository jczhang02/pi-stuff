/**
 * Optional model-scope enforcement for subagent model resolution.
 *
 * When `subagents.modelScope.enforce` is enabled in settings, a resolved model
 * that does not match any `allow` pattern is rejected. The severity depends on
 * where the model came from: an explicit caller-supplied model (`--model`,
 * tool-call `model`, or a TUI clarify pick) is a hard error, while a model
 * inherited from agent frontmatter / `defaultModel` / the parent session only
 * emits a warning so existing configurations keep working.
 *
 * The decision logic ({@link checkModelScope}) is a pure function of its
 * inputs so it can be unit-tested without touching the filesystem or config.
 */

import { isRuntimeBoolean, isRuntimeObject, isRuntimeString } from "../../../../shared/runtime-type.js";
import { splitKnownThinkingSuffix } from "../../shared/model-info.ts";

export interface ModelScopeConfig {
	enforce?: boolean;
	/** Glob-style allow patterns (only `*` is special), matched against `provider/id`. */
	allow?: string[];
}

/** Where a resolved model originated, deciding enforcement severity. */
export type ModelSource = "explicit" | "inherited";

export interface ModelScopeViolation {
	/** Resolved model id (without thinking suffix) that fell outside the scope. */
	model: string;
	severity: "warn" | "error";
	message: string;
	allowedPatterns: string[];
}

function stripThinkingSuffix(model: string): string {
	return splitKnownThinkingSuffix(model).baseModel;
}

/** Escape RegExp specials except `*`, then turn `*` into `.*`. */
function globToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`, "i");
}

/**
 * Test whether a resolved model matches a single allow pattern. Both sides are
 * compared case-insensitively against the full `provider/id` (thinking suffix
 * stripped from the model).
 */
export function matchesScopePattern(model: string, pattern: string): boolean {
	return globToRegExp(pattern).test(stripThinkingSuffix(model));
}

/**
 * Pure scope decision. Returns a {@link ModelScopeViolation} when the model is
 * out of scope and enforcement is on, otherwise `undefined`. Enforcement with
 * no `allow` list is a no-op (the settings parser rejects that combination, but
 * this stays defensive for callers that build configs programmatically).
 */
export function checkModelScope(
	model: string | undefined,
	scope: ModelScopeConfig | undefined,
	source: ModelSource,
): ModelScopeViolation | undefined {
	if (!model || !scope?.enforce) return undefined;
	const allow = scope.allow;
	if (!allow || allow.length === 0) return undefined;
	if (allow.some((pattern) => matchesScopePattern(model, pattern))) return undefined;

	const baseModel = stripThinkingSuffix(model);
	const severity: ModelScopeViolation["severity"] = source === "explicit" ? "error" : "warn";
	return {
		model: baseModel,
		severity,
		allowedPatterns: allow,
		message:
			`Model '${baseModel}' is outside the configured subagent model scope. ` +
			`Allowed patterns: ${allow.join(", ")}.`,
	};
}

/**
 * Validate and normalize a raw `subagents.modelScope` value from settings.
 * Throws a descriptive error for malformed configs (matching the surrounding
 * settings-parsing style). Returns `undefined` when the field is absent.
 */
export function parseModelScopeConfig<Value>(value: Value, meta: { filePath: string }): ModelScopeConfig | undefined {
	if (value === undefined) return undefined;
	if (!value || !isRuntimeObject(value) || Array.isArray(value)) {
		throw new Error(`Subagent settings in '${meta.filePath}' have invalid 'modelScope'; expected an object.`);
	}

	const config: ModelScopeConfig = {};

	if ("enforce" in value) {
		if (!isRuntimeBoolean(value.enforce)) {
			throw new Error(
				`Subagent settings in '${meta.filePath}' have invalid 'modelScope.enforce'; expected a boolean.`,
			);
		}
		config.enforce = value.enforce;
	}

	if ("allow" in value) {
		if (!Array.isArray(value.allow)) {
			throw new Error(
				`Subagent settings in '${meta.filePath}' have invalid 'modelScope.allow'; expected an array of strings.`,
			);
		}
		const allow: string[] = [];
		for (const entry of value.allow) {
			if (!isRuntimeString(entry)) {
				throw new Error(
					`Subagent settings in '${meta.filePath}' have invalid 'modelScope.allow'; expected an array of strings.`,
				);
			}
			const trimmed = entry.trim();
			if (trimmed) allow.push(trimmed);
		}
		if (allow.length === 0) {
			throw new Error(
				`Subagent settings in '${meta.filePath}' have invalid 'modelScope.allow'; expected a non-empty array of patterns.`,
			);
		}
		config.allow = allow;
	}

	if (config.enforce === true && (!config.allow || config.allow.length === 0)) {
		throw new Error(
			`Subagent settings in '${meta.filePath}' set modelScope.enforce without a non-empty 'allow' list; supply allowed model patterns or disable enforcement.`,
		);
	}

	return Object.keys(config).length > 0 ? config : undefined;
}
