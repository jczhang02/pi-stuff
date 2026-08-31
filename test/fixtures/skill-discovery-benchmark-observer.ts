import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

const EXPECTED_ENTRY_SCHEMA = Type.Object({
	description: Type.String(),
	location: Type.String(),
	name: Type.String(),
});
const EXPECTED_ENTRIES_SCHEMA = Type.Tuple([EXPECTED_ENTRY_SCHEMA, EXPECTED_ENTRY_SCHEMA, EXPECTED_ENTRY_SCHEMA]);
const PROVIDER_TOOL_SCHEMA = Type.Object(
	{
		function: Type.Optional(Type.Object({ name: Type.String() }, { additionalProperties: true })),
		name: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);
const PROVIDER_PAYLOAD_SCHEMA = Type.Object(
	{ tools: Type.Optional(Type.Array(PROVIDER_TOOL_SCHEMA)) },
	{ additionalProperties: true },
);

type ExpectedSkillEntry = Static<typeof EXPECTED_ENTRY_SCHEMA>;
type ProviderPayload = Static<typeof PROVIDER_PAYLOAD_SCHEMA>;
type ProviderTool = Static<typeof PROVIDER_TOOL_SCHEMA>;

function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function occurrences(text: string, fragment: string): number {
	return text.split(fragment).length - 1;
}

function expectedEntries(value: string | undefined): Static<typeof EXPECTED_ENTRIES_SCHEMA> | undefined {
	if (!value) return undefined;
	try {
		const parsed: unknown = JSON.parse(value);
		return Check(EXPECTED_ENTRIES_SCHEMA, parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function skillEntryCount(serializedPayload: string, entry: ExpectedSkillEntry): number {
	const block = [
		"  <skill>",
		`    <name>${xml(entry.name)}</name>`,
		`    <description>${xml(entry.description)}</description>`,
		`    <location>${xml(entry.location)}</location>`,
		"  </skill>",
	].join("\n");
	const serializedBlock = JSON.stringify(block).slice(1, -1);
	return occurrences(serializedPayload, serializedBlock);
}

function providerToolName(value: ProviderTool): string | undefined {
	return value.name ?? value.function?.name;
}

export function skillDiscoveryProviderToolNames(payload: ProviderPayload): readonly string[] {
	return [...new Set((payload.tools ?? []).map(providerToolName).filter((name) => name !== undefined))].sort();
}

export default function skillDiscoveryBenchmarkObserver(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event) => {
		const logPath = process.env["PI_STUFF_SKILL_DISCOVERY_BENCHMARK_LOG"];
		if (!logPath) return;
		const entries = expectedEntries(process.env["PI_STUFF_SKILL_DISCOVERY_BENCHMARK_ENTRIES"]);
		const payload = JSON.stringify(event.payload) ?? "";
		const toolNames = Check(PROVIDER_PAYLOAD_SCHEMA, event.payload)
			? skillDiscoveryProviderToolNames(event.payload)
			: [];
		appendFileSync(
			logPath,
			`${JSON.stringify({
				catalogBlocks: occurrences(payload, "<available_skills>"),
				configurationValid: entries !== undefined,
				entryCounts: entries?.map((entry) => skillEntryCount(payload, entry)) ?? [],
				toolNames,
				type: "provider-request",
			})}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);
	});
}
