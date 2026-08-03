import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import piStuffTools from "../../packages/pi-stuff-tools/index.js";

type EventHandler = (event: ExtensionEvent, ctx: ExtensionContext) => Promise<unknown> | unknown;

class EventBusHarness {
	on(): () => void {
		return () => {};
	}

	emit(): void {}
}

function apiHarness(initialActiveTools: readonly string[]): {
	readonly api: ExtensionAPI;
	readonly tools: Map<string, ToolDefinition>;
	emit(type: ExtensionEvent["type"], event: ExtensionEvent, ctx: ExtensionContext): Promise<void>;
	getActiveTools(): readonly string[];
	setActiveTools(names: readonly string[]): void;
} {
	const handlers = new Map<string, EventHandler[]>();
	const tools = new Map<string, ToolDefinition>();
	let activeTools = [...initialActiveTools];
	const api = {
		events: new EventBusHarness(),
		getActiveTools: () => [...activeTools],
		on: (type: string, handler: EventHandler) => {
			handlers.set(type, [...(handlers.get(type) ?? []), handler]);
		},
		registerCommand: () => {},
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		setActiveTools: (names: string[]) => {
			activeTools = [...names];
		},
	} as unknown as ExtensionAPI;
	return {
		api,
		tools,
		emit: async (type, event, ctx) => {
			for (const handler of handlers.get(type) ?? []) await handler(event, ctx);
		},
		getActiveTools: () => [...activeTools],
		setActiveTools: (names) => {
			activeTools = [...names];
		},
	};
}

function context(cwd: string): ExtensionContext {
	return {
		cwd,
		isProjectTrusted: () => true,
	} as unknown as ExtensionContext;
}

test("resume pre-binds only active built-in renderers before historical rows are reconstructed", async () => {
	const outgoing = apiHarness(["read", "grep", "fixture_state"]);
	await piStuffTools(outgoing.api);
	await outgoing.emit(
		"session_shutdown",
		{ reason: "resume", targetSessionFile: "/sessions/target.jsonl", type: "session_shutdown" },
		context("/outgoing"),
	);

	const incoming = apiHarness(["read", "bash", "edit", "write", "fixture_state"]);
	await piStuffTools(incoming.api);

	expect([...incoming.tools.keys()].sort()).toEqual(["grep", "read"]);

	await incoming.emit("session_start", { reason: "resume", type: "session_start" }, context("/target"));
	expect(incoming.getActiveTools()).toEqual(["read", "grep", "fixture_state"]);

	await incoming.emit("session_shutdown", { reason: "quit", type: "session_shutdown" }, context("/target"));
});

test("resume preserves default, disabled, and allowlisted built-in membership exactly", async () => {
	for (const expected of [["bash", "edit", "read", "write"], [], ["find", "grep", "ls"]] as const) {
		const outgoing = apiHarness([...expected, "fixture_state"]);
		await piStuffTools(outgoing.api);
		await outgoing.emit(
			"session_shutdown",
			{ reason: "resume", targetSessionFile: "/sessions/target.jsonl", type: "session_shutdown" },
			context("/outgoing"),
		);

		const incoming = apiHarness(["read", "bash", "edit", "write", "fixture_state"]);
		await piStuffTools(incoming.api);
		expect([...incoming.tools.keys()].sort()).toEqual([...expected].sort());

		await incoming.emit("session_start", { reason: "resume", type: "session_start" }, context("/target"));
		expect(incoming.getActiveTools()).toEqual([...expected, "fixture_state"]);
		await incoming.emit("session_shutdown", { reason: "quit", type: "session_shutdown" }, context("/target"));
	}
});

test("resumed built-ins execute against the target cwd and trusted project settings", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-stuff-tools-resume-cwd-"));
	const outgoingDirectory = join(directory, "outgoing");
	const targetDirectory = join(directory, "target");
	await Promise.all([mkdir(outgoingDirectory), mkdir(join(targetDirectory, ".pi"), { recursive: true })]);
	await Promise.all([
		writeFile(join(targetDirectory, "target.txt"), "TARGET_CWD_CONTENT\n"),
		writeFile(
			join(targetDirectory, ".pi", "settings.json"),
			`${JSON.stringify({ shellCommandPrefix: "printf 'TARGET_PROJECT_PREFIX\\n';" })}\n`,
		),
	]);

	try {
		const outgoing = apiHarness(["read", "bash"]);
		await piStuffTools(outgoing.api);
		await outgoing.emit(
			"session_shutdown",
			{ reason: "resume", targetSessionFile: "/sessions/target.jsonl", type: "session_shutdown" },
			context(outgoingDirectory),
		);

		const incoming = apiHarness(["read", "bash"]);
		await piStuffTools(incoming.api);
		await incoming.emit("session_start", { reason: "resume", type: "session_start" }, context(targetDirectory));

		const read = incoming.tools.get("read");
		const bash = incoming.tools.get("bash");
		if (!read || !bash) throw new Error("Expected resumed Read and Bash definitions");
		const readResult = await read.execute(
			"read-target",
			{ path: "target.txt" },
			new AbortController().signal,
			undefined,
			{} as never,
		);
		const bashResult = await bash.execute(
			"bash-target",
			{ command: "printf 'TARGET_BODY\\n'" },
			new AbortController().signal,
			undefined,
			undefined as never,
		);
		const text = (result: AgentToolResult<unknown>): string =>
			result.content
				.filter((part): part is { text: string; type: "text" } => part.type === "text")
				.map((part) => part.text)
				.join("\n");

		expect(text(readResult)).toContain("TARGET_CWD_CONTENT");
		expect(text(bashResult)).toContain("TARGET_PROJECT_PREFIX\nTARGET_BODY");
		await incoming.emit("session_shutdown", { reason: "quit", type: "session_shutdown" }, context(targetDirectory));
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
