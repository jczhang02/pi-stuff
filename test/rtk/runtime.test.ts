import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CERTIFIED_RTK_VERSION, RtkRuntime } from "../../packages/pi-stuff-rtk/runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fakeBinary(content = "fixture-rtk"): Promise<{ path: string; sha256: string }> {
	const directory = await mkdtemp(join(tmpdir(), "pi-stuff-rtk-runtime-"));
	temporaryDirectories.push(directory);
	const path = join(directory, "rtk");
	await writeFile(path, content);
	await chmod(path, 0o755);
	const sha256 = createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
	return { path, sha256 };
}

function result(stdout = "", code = 0, options: { killed?: boolean; stderr?: string } = {}) {
	return {
		code,
		killed: options.killed ?? false,
		stderr: options.stderr ?? "",
		stdout,
	};
}

describe("RTK runtime certification", () => {
	test("verifies one exact executable and rewrites through its absolute path", async () => {
		const binary = await fakeBinary();
		const calls: Array<{ args: string[]; command: string }> = [];
		const pi = {
			exec: async (command: string, args: string[]) => {
				calls.push({ args, command });
				if (command === "which") return result(`${binary.path}\n`);
				if (args[0] === "--version") return result(`rtk ${CERTIFIED_RTK_VERSION}\n`);
				if (args[0] === "rewrite") return result("rtk git status\n", 3);
				return result("", 1);
			},
		} as Pick<ExtensionAPI, "exec">;
		const runtime = new RtkRuntime({ expectedSha256: binary.sha256 });

		expect(await runtime.rewrite(pi, "git status")).toBe("rtk git status");
		expect(runtime.snapshot()).toMatchObject({
			path: binary.path,
			sha256: binary.sha256,
			state: "ready",
			version: CERTIFIED_RTK_VERSION,
		});
		expect(calls.some((call) => call.command === binary.path && call.args[0] === "rewrite")).toBe(true);
	});

	test("keeps the original command when RTK is missing and avoids repeated probes", async () => {
		let probes = 0;
		const pi = {
			exec: async () => {
				probes += 1;
				return result("", 1);
			},
		} as Pick<ExtensionAPI, "exec">;
		const runtime = new RtkRuntime({ expectedSha256: "unused" });

		expect(await runtime.rewrite(pi, "git status")).toBeUndefined();
		expect(await runtime.rewrite(pi, "git diff")).toBeUndefined();
		expect(probes).toBe(1);
		expect(runtime.snapshot().state).toBe("unavailable");
	});

	test("fails open when the current platform has no certified binary identity", async () => {
		const binary = await fakeBinary();
		let rewriteCalls = 0;
		const pi = {
			exec: async (command: string, args: string[]) => {
				if (command === "which") return result(`${binary.path}\n`);
				if (args[0] === "--version") return result(`rtk ${CERTIFIED_RTK_VERSION}\n`);
				if (args[0] === "rewrite") rewriteCalls += 1;
				return result("rtk git status\n", 3);
			},
		} as Pick<ExtensionAPI, "exec">;
		const runtime = new RtkRuntime({ platform: "darwin" });

		expect(await runtime.rewrite(pi, "git status")).toBeUndefined();
		expect(rewriteCalls).toBe(0);
		expect(runtime.snapshot()).toMatchObject({ state: "unavailable" });
	});

	test("fails open on timeout and stops retrying the slow executable", async () => {
		const binary = await fakeBinary();
		let rewriteCalls = 0;
		const pi = {
			exec: async (command: string, args: string[]) => {
				if (command === "which") return result(`${binary.path}\n`);
				if (args[0] === "--version") return result(`rtk ${CERTIFIED_RTK_VERSION}\n`);
				if (args[0] === "rewrite") {
					rewriteCalls += 1;
					throw new Error("timed out");
				}
				return result("", 1);
			},
		} as Pick<ExtensionAPI, "exec">;
		const runtime = new RtkRuntime({ expectedSha256: binary.sha256 });

		expect(await runtime.rewrite(pi, "git status")).toBeUndefined();
		expect(await runtime.rewrite(pi, "git diff")).toBeUndefined();
		expect(rewriteCalls).toBe(1);
		expect(runtime.snapshot()).toMatchObject({ state: "unavailable" });
	});

	test("detects path and executable drift before running rewritten commands", async () => {
		const first = await fakeBinary("first");
		const second = await fakeBinary("second");
		let selectedPath = first.path;
		let rewriteCalls = 0;
		const pi = {
			exec: async (command: string, args: string[]) => {
				if (command === "which") return result(`${selectedPath}\n`);
				if (args[0] === "--version") return result(`rtk ${CERTIFIED_RTK_VERSION}\n`);
				if (args[0] === "rewrite") {
					rewriteCalls += 1;
					return result("rtk git status\n", 3);
				}
				return result("", 1);
			},
		} as Pick<ExtensionAPI, "exec">;
		const runtime = new RtkRuntime({ expectedSha256: first.sha256 });

		expect(await runtime.rewrite(pi, "git status")).toBe("rtk git status");
		selectedPath = second.path;
		expect(await runtime.rewrite(pi, "git diff")).toBeUndefined();
		expect(rewriteCalls).toBe(1);
		expect(runtime.snapshot().state).toBe("drifted");
	});

	test("detects in-place binary drift and allows explicit re-certification", async () => {
		const binary = await fakeBinary("first");
		let expectedSha256 = binary.sha256;
		const pi = {
			exec: async (command: string, args: string[]) => {
				if (command === "which") return result(`${binary.path}\n`);
				if (args[0] === "--version") return result(`rtk ${CERTIFIED_RTK_VERSION}\n`);
				if (args[0] === "rewrite") return result("rtk git status\n", 3);
				return result("", 1);
			},
		} as Pick<ExtensionAPI, "exec">;
		const runtime = new RtkRuntime({ expectedSha256 });

		expect(await runtime.rewrite(pi, "git status")).toBeDefined();
		await writeFile(binary.path, "changed");
		expect(await runtime.rewrite(pi, "git status")).toBeUndefined();
		expect(runtime.snapshot().state).toBe("drifted");

		expectedSha256 = createHash("sha256")
			.update(await readFile(binary.path))
			.digest("hex");
		const replacementRuntime = new RtkRuntime({ expectedSha256 });
		expect((await replacementRuntime.verify(pi, { refresh: true })).state).toBe("ready");
	});

	test("does not rewrite empty or already-RTK commands", async () => {
		let calls = 0;
		const pi = {
			exec: async () => {
				calls += 1;
				return result("", 1);
			},
		} as Pick<ExtensionAPI, "exec">;
		const runtime = new RtkRuntime();

		expect(await runtime.rewrite(pi, "  ")).toBeUndefined();
		expect(await runtime.rewrite(pi, "rtk git status")).toBeUndefined();
		expect(await runtime.rewrite(pi, "CI=1 rtk git status")).toBeUndefined();
		expect(calls).toBe(0);
	});
});
