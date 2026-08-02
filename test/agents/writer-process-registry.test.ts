import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	initializeWriterProcessRegistry,
	inspectWriterProcessLiveness,
	terminateOrphanWriterProcesses,
	writerProcessRegistryPath,
} from "../../packages/pi-stuff-agents/src/runs/background/writer-process-registry.js";

const roots = new Set<string>();

afterEach(() => {
	for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
	roots.clear();
});

function fixture(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-writer-registry-"));
	roots.add(root);
	return root;
}

describe("writer process recovery evidence", () => {
	test("treats missing and corrupt registries as unknown instead of proving termination", () => {
		const asyncDir = fixture();
		expect(inspectWriterProcessLiveness(asyncDir)).toBeUndefined();
		expect(terminateOrphanWriterProcesses(asyncDir)).toEqual({ remaining: 1, terminated: 0 });

		fs.writeFileSync(writerProcessRegistryPath(asyncDir), "{not-json", "utf-8");
		expect(inspectWriterProcessLiveness(asyncDir)).toBeUndefined();
		expect(terminateOrphanWriterProcesses(asyncDir)).toEqual({ remaining: 1, terminated: 0 });
	});

	test("accepts an initialized registry with every writer explicitly absent", () => {
		const asyncDir = fixture();
		initializeWriterProcessRegistry(asyncDir, "run", process.pid, 2);

		expect(inspectWriterProcessLiveness(asyncDir)).toBeFalse();
		expect(terminateOrphanWriterProcesses(asyncDir)).toEqual({ remaining: 0, terminated: 0 });
	});

	test("never signals a live PID without matching process-start identity", () => {
		const asyncDir = fixture();
		fs.writeFileSync(
			writerProcessRegistryPath(asyncDir),
			JSON.stringify({
				version: 1,
				runId: "run",
				runnerPid: process.pid,
				updatedAt: Date.now(),
				writers: { "0": { state: "running", pid: 999_999, processStartIdentity: "unavailable-now" } },
			}),
			"utf-8",
		);
		const signals: Array<NodeJS.Signals | 0 | undefined> = [];
		const fakeKill = (_pid: number, signal?: NodeJS.Signals | 0): boolean => {
			signals.push(signal);
			return true;
		};

		expect(inspectWriterProcessLiveness(asyncDir, fakeKill)).toBeUndefined();
		expect(terminateOrphanWriterProcesses(asyncDir, fakeKill)).toEqual({ remaining: 1, terminated: 0 });
		expect(signals.every((signal) => signal === 0)).toBeTrue();
	});
});
