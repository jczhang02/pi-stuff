/** Generate disposable, model-free Pi sessions for the tool UI comparison. */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { CERTIFIED_PI_VERSION } from "../../../scripts/pi-host-contract.js";

type FixtureVariant = "bounded" | "grouped" | "individual";
type ToolAction = "read" | "search" | "test";

interface ToolOperation {
	action: ToolAction;
	detailLines: string[];
	itemId: string;
	summary: string;
	target: string;
}

const GROUP_ID = "tool-ui-investigation";
const GROUP_LABEL = "Investigated tool UI · read 2 sources · 12 matches in 5 files";
const GROUP_SIZE = 3;
const SESSION_IDS: Record<FixtureVariant, string> = {
	individual: "33333333-3333-4333-8333-333333333331",
	grouped: "33333333-3333-4333-8333-333333333332",
	bounded: "33333333-3333-4333-8333-333333333333",
};
const VARIANT_TIMESTAMP_OFFSETS: Record<FixtureVariant, number> = {
	individual: 0,
	grouped: 20,
	bounded: 40,
};
const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};
const OPERATIONS: ToolOperation[] = [
	{
		itemId: "suite-entry",
		action: "read",
		target: "packages/pi-stuff/src/index.ts",
		summary: "46 lines",
		detailLines: [
			'1  import registerTodo from "./src/todo/index.js";',
			'2  import registerSubagents from "./src/subagents/index.js";',
			"8  export default function registerSuite(pi: ExtensionAPI): void {",
			"9    registerTodo(pi);",
			"10   registerAgents(pi);",
			"11 }",
		],
	},
	{
		itemId: "tool-renderers",
		action: "search",
		target: "registerTool( · packages/",
		summary: "12 matches in 5 files",
		detailLines: [
			"packages/pi-stuff/src/subagents/index.ts:42",
			"packages/pi-stuff/src/todo/index.ts:31",
			"packages/pi-stuff/src/tool-display/builtin-tools.ts:18",
			"packages/pi-stuff/src/tool-display/builtin-tools.ts:22",
			"packages/pi-stuff/src/tool-display/builtin-tools.ts:27",
		],
	},
	{
		itemId: "tidy-tools-notes",
		action: "read",
		target: "docs/research/pi-tidy-tools-ui-reference.md",
		summary: "214 lines",
		detailLines: [
			"Compact operation records are a useful baseline.",
			"Running state should update the same transcript record.",
			"Global expansion becomes expensive in long sessions.",
			"Errors need attached, actionable context.",
		],
	},
	{
		itemId: "baseline-tests",
		action: "test",
		target: "bun test --filter pi-stuff",
		summary: "128 passed · 0 failed · 1.84s",
		detailLines: [
			"bun test v1.4.0",
			"test/suite-generator.test.ts:",
			"  ✓ emits the ordered default extension",
			"  ✓ preserves capability package order",
			"test/package-loader.test.ts:",
			"  ✓ discovers the aggregate package",
			"  ✓ loads the extracted npm tarball",
			"test/public-safety.test.ts:",
			"  ✓ rejects private absolute paths",
			"  ✓ excludes local session state",
			"test/host-rpc.test.ts:",
			`  ✓ starts Pi ${CERTIFIED_PI_VERSION} without a model`,
			"  ✓ discovers all default capabilities",
			"test/tool-renderer.test.ts:",
			"  ✓ renders running state in place",
			"  ✓ keeps compact success summaries",
			"  ✓ attaches failure context",
			"  ✓ bounds transcript detail",
			"  ✓ opens one operation in Tool Details",
			"128 pass",
			"0 fail",
			"FULL TEST OUTPUT · shard 24/24 complete",
			"Ran 128 tests across 18 files. [1.84s]",
		],
	},
];

function isFixtureVariant(value: string | undefined): value is FixtureVariant {
	return value === "individual" || value === "grouped" || value === "bounded";
}

const variantArgument = process.argv[2];
const outputDirectoryArgument = process.argv[3];

if (!isFixtureVariant(variantArgument) || !outputDirectoryArgument) {
	throw new Error("Usage: bun tool-ui-comparison-fixture.ts <individual|grouped|bounded> <output-directory>");
}

const variant = variantArgument;
const outputDirectory = resolve(outputDirectoryArgument);
await mkdir(outputDirectory, { recursive: true });

const session = SessionManager.create(process.cwd(), outputDirectory, {
	id: SESSION_IDS[variant],
});
const baseTimestamp = Date.UTC(2026, 7, 1, 7, 0, VARIANT_TIMESTAMP_OFFSETS[variant]);

session.appendMessage({
	role: "user",
	content: "确认工具调用在主对话中的默认显示方式。",
	timestamp: baseTimestamp,
});

session.appendMessage({
	role: "assistant",
	content: [
		{ type: "text", text: "我先查看入口、现有渲染约束和测试基线。" },
		...OPERATIONS.map((operation, index) => ({
			type: "toolCall" as const,
			id: `${variant}-operation-${index + 1}`,
			name: "prototype_tool_action",
			arguments: {
				variant,
				action: operation.action,
				target: operation.target,
			},
		})),
	],
	api: "anthropic-messages",
	provider: "fixture",
	model: "tool-ui-fixture",
	usage: ZERO_USAGE,
	stopReason: "toolUse",
	timestamp: baseTimestamp + 1_000,
});

for (const [index, operation] of OPERATIONS.entries()) {
	const belongsToExplorationGroup = index < GROUP_SIZE;
	session.appendMessage({
		role: "toolResult",
		toolCallId: `${variant}-operation-${index + 1}`,
		toolName: "prototype_tool_action",
		content: [{ type: "text", text: operation.detailLines.join("\n") }],
		details: {
			variant,
			itemId: operation.itemId,
			action: operation.action,
			target: operation.target,
			summary: operation.summary,
			detailLines: operation.detailLines,
			...(belongsToExplorationGroup
				? {
						groupId: GROUP_ID,
						...(index === 0
							? {
									groupLabel: GROUP_LABEL,
									groupChildren: OPERATIONS.slice(0, GROUP_SIZE).map(({ action, target, summary }) => ({
										action,
										target,
										summary,
									})),
								}
							: {}),
						groupPosition: index,
						groupSize: GROUP_SIZE,
					}
				: {}),
		},
		isError: false,
		timestamp: baseTimestamp + 2_000 + index * 1_000,
	});
}

session.appendMessage({
	role: "assistant",
	content: [
		{
			type: "text",
			text: "入口、渲染约束和测试基线都已确认。",
		},
	],
	api: "anthropic-messages",
	provider: "fixture",
	model: "tool-ui-fixture",
	usage: ZERO_USAGE,
	stopReason: "stop",
	timestamp: baseTimestamp + 2_000 + OPERATIONS.length * 1_000,
});

const sessionFile = session.getSessionFile();
if (!sessionFile) throw new Error("Session fixture was not persisted");
process.stdout.write(`${sessionFile}\n`);
