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
		writeFileSync(file, `old\n${"x".repeat(80)}\n\u001b[31mfinal\u001b[0m`);
		const output = await readAgentTranscript(request(row({ transcriptPath: file }), 40));
		expect(output).toContain("earlier transcript omitted");
		expect(output).toContain("final");
		expect(output).not.toContain("\u001b");
		expect(output?.length).toBeLessThan(80);
	});

	test("projects recent JSONL messages and compact tool starts", async () => {
		const file = join(tempDirectory(), "session.jsonl");
		writeFileSync(
			file,
			[
				JSON.stringify({ recordType: "message", message: { role: "user", content: "Investigate" } }),
				JSON.stringify({ recordType: "tool_start", toolName: "read", argsPreview: "src/a.ts" }),
				JSON.stringify({
					recordType: "message",
					message: { role: "assistant", content: [{ type: "text", text: "Found it" }] },
				}),
			].join("\n"),
		);
		const output = await readAgentTranscript(request(row({ sessionFile: file })));
		expect(output).toBe("User\nInvestigate\n\nTool · read src/a.ts\n\nAgent\nFound it");
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
