import { isAbsolute } from "node:path";
import { isJsonInputObject, type JsonInputValue } from "../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";
import type { SkillDiscoveryManifest } from "./skill-discovery-benchmark-core.js";

const FORBIDDEN_KEYS = new Set([
	"assistantText",
	"credential",
	"error",
	"prompt",
	"providerPayload",
	"sessionFile",
	"sessionId",
	"skillBody",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function strings(value: JsonInputValue, output: string[], keys: string[]): void {
	if (isRuntimeString(value)) {
		output.push(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) strings(item, output, keys);
		return;
	}
	if (!isJsonInputObject(value)) return;
	for (const [key, item] of Object.entries(value)) {
		keys.push(key);
		strings(item, output, keys);
	}
}

export function assertSanitizedSkillDiscoveryReport(
	report: JsonInputValue,
	manifest: SkillDiscoveryManifest,
	privateValues: readonly string[] = [],
): void {
	const values: string[] = [];
	const keys: string[] = [];
	strings(report, values, keys);
	if (keys.some((key) => FORBIDDEN_KEYS.has(key)))
		throw new Error("Skill Discovery report contains a forbidden field");
	if (values.some((value) => isAbsolute(value) || UUID.test(value)))
		throw new Error("Skill Discovery report contains a private absolute path or Session identifier");
	const sensitive = [
		...privateValues,
		...manifest.tasks.flatMap((task) => [task.prompt, task.expectedToken, ...task.files.map((file) => file.content)]),
	].filter(Boolean);
	const serialized = JSON.stringify(report);
	if (sensitive.some((value) => serialized.includes(value)))
		throw new Error("Skill Discovery report contains prompt, outcome text, fixture content, or private state");
}
