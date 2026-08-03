import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRow } from "../../packages/pi-stuff-agents/src/session/current-agents.js";
import { readAgentTranscript } from "../../packages/pi-stuff-agents/src/ui/agent-transcript.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function tempDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "pi-stuff-agent-transcript-"));
	temporaryDirectories.push(directory);
	return directory;
}

function row(overrides: Partial<AgentRow>): AgentRow {
	return {
		childIndex: 0,
		elapsedMs: 100,
		key: "run:0",
		name: "worker",
		nestedCount: 0,
		partialResult: null,
		runId: "run",
		savedOutputPath: null,
		sessionFile: null,
		sessionId: "root",
		startedAt: 1,
		status: "running",
		task: "work",
		transcriptPath: null,
		...overrides,
	};
}

function request(agentRow: AgentRow, maxChars = 24_000) {
	return { maxChars, row: agentRow, signal: new AbortController().signal };
}

describe("readAgentTranscript", () => {
	test("reads a bounded plain transcript and strips terminal controls", async () => {
		const file = join(tempDirectory(), "transcript.md");
		writeFileSync(file, `old\n${"x".repeat(80)}\n\u001b[31mfinal 👩‍💻\u001b[0m \u001bc`);
		const output = await readAgentTranscript(request(row({ transcriptPath: file }), 40));
		expect(output).toContain("earlier transcript omitted");
		expect(output).toContain("final");
		expect(output).toContain("👩‍💻");
		expect(output).not.toContain("\u001b");
		expect(output).not.toEndWith("c");
		expect(output?.length).toBeLessThan(80);
	});

	test("pairs child Tool calls and results by persisted identity", async () => {
		const file = join(tempDirectory(), "session.jsonl");
		writeFileSync(
			file,
			[
				JSON.stringify({ recordType: "message", message: { role: "user", content: "Investigate" } }),
				JSON.stringify({
					recordType: "tool_start",
					toolCallId: "read-1",
					toolName: "read",
					argsPreview: "src/a.ts",
				}),
				JSON.stringify({
					recordType: "tool_end",
					toolCallId: "read-1",
					toolName: "read",
					isError: false,
				}),
				JSON.stringify({
					recordType: "message",
					toolCallId: "read-1",
					toolName: "read",
					isError: false,
					message: {
						role: "toolResult",
						toolCallId: "read-1",
						toolName: "read",
						isError: false,
						content: [{ type: "text", text: "112 lines" }],
					},
				}),
				JSON.stringify({
					recordType: "message",
					message: { role: "assistant", content: [{ type: "text", text: "Found it" }] },
				}),
			].join("\n"),
		);
		const output = await readAgentTranscript(request(row({ sessionFile: file })));
		expect(output).toBe("User\nInvestigate\n\n● Read src/a.ts · completed\n112 lines\n\nAgent\nFound it");
	});

	test("keeps mixed and out-of-order child Tool outcomes attributable", async () => {
		const file = join(tempDirectory(), "session.jsonl");
		writeFileSync(
			file,
			[
				JSON.stringify({
					recordType: "tool_start",
					toolCallId: "read-1",
					toolName: "read",
					argsPreview: "src/配置🧪.ts",
				}),
				JSON.stringify({
					recordType: "tool_start",
					toolCallId: "bash-1",
					toolName: "bash",
					argsPreview: "bun test",
				}),
				JSON.stringify({
					recordType: "message",
					toolCallId: "bash-1",
					toolName: "bash",
					isError: true,
					message: {
						role: "toolResult",
						toolCallId: "bash-1",
						toolName: "bash",
						isError: true,
						content: [{ type: "text", text: "Command aborted" }],
					},
				}),
				JSON.stringify({
					recordType: "message",
					toolCallId: "read-1",
					toolName: "read",
					message: {
						role: "toolResult",
						toolCallId: "read-1",
						toolName: "read",
						content: [{ type: "text", text: "file contents" }],
					},
				}),
			].join("\n"),
		);

		const output = await readAgentTranscript(request(row({ sessionFile: file })));
		expect(output).toBe(
			"● Read src/配置🧪.ts · completed\nfile contents\n\n● Bash bun test · cancelled\nCommand aborted",
		);
	});

	test("distinguishes rejected results and degrades legacy records without false ownership", async () => {
		const file = join(tempDirectory(), "session.jsonl");
		writeFileSync(
			file,
			[
				JSON.stringify({
					recordType: "tool_start",
					toolCallId: "write-1",
					toolName: "write",
					argsPreview: "/outside/project\u001b]0;hidden-title\u0007",
				}),
				JSON.stringify({
					recordType: "message",
					toolCallId: "write-1",
					toolName: "write",
					isError: true,
					message: {
						role: "toolResult",
						toolCallId: "write-1",
						toolName: "write",
						isError: true,
						content: [{ type: "text", text: "\u001b[31m[pi-stuff-permissions] approval rejected\u001b[0m" }],
					},
				}),
				JSON.stringify({
					recordType: "tool_end",
					toolCallId: "edit-1",
					toolName: "edit",
					isError: true,
				}),
				JSON.stringify({
					recordType: "message",
					toolCallId: "edit-1",
					toolName: "edit",
					message: {
						role: "toolResult",
						toolCallId: "edit-1",
						toolName: "edit",
						content: [{ type: "text", text: "compiler failure" }],
					},
				}),
				JSON.stringify({ recordType: "tool_start", toolName: "read", argsPreview: "first.ts" }),
				JSON.stringify({ recordType: "tool_start", toolName: "read", argsPreview: "second.ts" }),
				JSON.stringify({
					recordType: "message",
					message: { role: "toolResult", content: [{ type: "text", text: "legacy result" }] },
				}),
			].join("\n"),
		);

		const output = await readAgentTranscript(request(row({ sessionFile: file })));
		expect(output).toContain("● Write /outside/project · rejected");
		expect(output).toContain("● Edit · failed\ncompiler failure");
		expect(output).toContain("● Read first.ts · running");
		expect(output).toContain("● Read second.ts · running");
		expect(output).toContain("● Tool · completed\nlegacy result");
		expect(output).not.toContain("● Read first.ts · completed");
		expect(output).not.toContain("● Read second.ts · completed");
		expect(output).not.toContain("hidden-title");
		expect(output).not.toContain("\u001b");
	});

	test("uses the partial result when no readable artifact exists", async () => {
		const output = await readAgentTranscript(request(row({ partialResult: "partial work" })));
		expect(output).toBe("partial work");
	});

	test("refuses relative and symlink transcript targets", async () => {
		const directory = tempDirectory();
		const target = join(directory, "target.md");
		const link = join(directory, "link.md");
		writeFileSync(target, "secret");
		symlinkSync(target, link);
		expect(
			await readAgentTranscript(request(row({ partialResult: "fallback", transcriptPath: "relative.md" }))),
		).toBe("fallback");
		expect(() => readAgentTranscript(request(row({ transcriptPath: link })))).toThrow();
	});

	test("returns quietly when its dialog signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const output = await readAgentTranscript({
			maxChars: 100,
			row: row({ partialResult: "hidden" }),
			signal: controller.signal,
		});
		expect(output).toBeNull();
	});
});
