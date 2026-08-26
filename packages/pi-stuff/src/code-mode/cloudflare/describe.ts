/**
 * Connector and snippet docs rendering — derives TypeScript documentation from
 * connector descriptors on demand. Also renders snippet source.
 */

import { isRuntimeString } from "../../shared/runtime-type.js";
import type { ConnectorDescription, DescribeOutput } from "./connector-types.js";
import { generateTypesFromJsonSchema, type JsonSchemaToolDescriptors } from "./json-schema-types.js";
import type { Snippet } from "./snippet.js";
import { sanitizeToolName, toolPath } from "./utils.js";

function splitTarget(target: string): readonly [string, string | undefined] {
	const bracket = target.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\[("(?:\\.|[^"\\])*")\]$/u);
	const owner = bracket?.[1];
	const literal = bracket?.[2];
	if (owner && literal) {
		try {
			const method: unknown = JSON.parse(literal);
			if (isRuntimeString(method)) return [owner, method];
		} catch {
			// Malformed bracket targets fall through to the ordinary not-found result.
		}
	}
	const separator = target.indexOf(".");
	return separator < 0 ? [target, undefined] : [target.slice(0, separator), target.slice(separator + 1)];
}

function renderConnectorTypes(
	connectorName: string,
	instructions: string | undefined,
	descriptors: JsonSchemaToolDescriptors,
): string {
	const types = generateTypesFromJsonSchema(descriptors).replace(
		"declare const codemode",
		`declare const ${sanitizeToolName(connectorName)}`,
	);
	return [instructions, types].filter(Boolean).join("\n\n");
}

function renderMethodTypes(methodName: string, descriptors: JsonSchemaToolDescriptors): string {
	const descriptor = descriptors[methodName];
	if (!descriptor) return "";
	const generated = generateTypesFromJsonSchema({ [methodName]: descriptor });
	return generated.slice(0, generated.indexOf("declare const codemode")).trim();
}

export function describeTarget(
	target: string,
	descriptions: ConnectorDescription[],
	snippets?: Snippet[],
): DescribeOutput {
	// Check snippets first
	if (snippets) {
		const snippet = snippets.find((s) => s.name === target);
		if (snippet) {
			const parts = [snippet.description];
			parts.push(`\`\`\`ts\n${snippet.code}\n\`\`\``);
			return {
				path: snippet.name,
				description: snippet.description,
				types: parts.join("\n\n"),
				kind: "snippet",
			};
		}
	}

	const [maybeConnector, maybeMethod] = splitTarget(target);

	const connector = descriptions.find((d) => d.name === maybeConnector);

	// Connector-level describe
	if (connector && !maybeMethod) {
		return {
			path: connector.name,
			description: connector.instructions,
			types: renderConnectorTypes(connector.name, connector.instructions, connector.descriptors),
			kind: "connector",
		};
	}

	// Method-level describe
	const candidates = connector ? [connector] : descriptions;
	const methodName = maybeMethod ?? target;

	for (const candidate of candidates) {
		if (candidate.descriptors[methodName]) {
			const result: DescribeOutput = {
				path: toolPath(methodName, candidate.name),
				description: candidate.descriptors[methodName]?.description,
				types: renderMethodTypes(methodName, candidate.descriptors),
				kind: "method",
			};
			if (candidate.annotations?.[methodName]?.requiresApproval) {
				Object.assign(result, { requiresApproval: true });
			}
			return result;
		}
	}

	return {
		path: target,
		description: undefined,
		types: `"${target}" not found.`,
		kind: "method",
	};
}
