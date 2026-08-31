import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import * as Effect from "effect/Effect";
import {
	CERTIFIED_RTK_LINUX_X64_SHA256,
	CERTIFIED_RTK_VERSION,
	RtkRuntime,
} from "../../packages/pi-stuff/src/rtk/runtime.js";

const temporaryDirectories: string[] = [];

function run<Value, ErrorType>(program: Effect.Effect<Value, ErrorType>): Promise<Value> {
	return Effect.runPromise(program);
}

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

test("keeps the official release identity synchronized with CI and provenance", async () => {
	const root = join(import.meta.dir, "../..");
	const records = await Promise.all(
		[
			".github/workflows/ci.yml",
			"docs/compatibility.md",
			"packages/pi-stuff/src/rtk/README.md",
			"packages/pi-stuff/src/rtk/UPSTREAM.md",
		].map((path) => readFile(join(root, path), "utf8")),
	);
	for (const record of records) {
		expect(record).toContain(CERTIFIED_RTK_VERSION);
		expect(record).toContain(CERTIFIED_RTK_LINUX_X64_SHA256);
	}
	expect(records[0]).toContain("c4c036fbf181fc55ef329786c8c17e0d427972b053b825944d968a6aafef1ba4");
	expect(records[2]).toContain("compound predicates");
	expect(records[3]).not.toContain("Maintainer source build");
});

test("rejects an uncertified executable that reports the certified version", async () => {
	const binary = await fakeBinary();
	// SAFETY: this test controls the value and supplies every Pick member exercised by this case.
	const pi = {
		exec: async (command: string, args: string[]) => {
			if (command === "which") return result(`${binary.path}\n`);
			if (args[0] === "--version") return result(`rtk ${CERTIFIED_RTK_VERSION}\n`);
			return result("", 1);
		},
	} as Pick<ExtensionAPI, "exec">;

	expect(await run(new RtkRuntime().verify(pi))).toMatchObject({ state: "unavailable" });
});

test("bounds runtime errors by terminal cells", async () => {
	const runtime = new RtkRuntime({ expectedSha256: "unused" });
	// SAFETY: this test controls the value and supplies every Pick member exercised by this case.
	await run(
		runtime.verify({
			exec: async () => {
				throw new Error(`\u001b[31m${"失败😀".repeat(100)}\u001b[0m`);
			},
		} as Pick<ExtensionAPI, "exec">),
	);
	const error = runtime.snapshot().lastError ?? "";
	expect(visibleWidth(error)).toBeLessThanOrEqual(220 + visibleWidth("RTK verification failed: "));
	expect(error).not.toContain("\u001b");
});

test("verifies one exact executable and rewrites through its absolute path", async () => {
	const binary = await fakeBinary();
	const calls: Array<{ args: string[]; command: string }> = [];
	// SAFETY: this test controls the value and supplies every Pick member exercised by this case.
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

	expect(await run(runtime.rewrite(pi, "git status"))).toBe("rtk git status");
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
	// SAFETY: this test controls the value and supplies every Pick member exercised by this case.
	const pi = {
		exec: async () => {
			probes += 1;
			return result("", 1);
		},
	} as Pick<ExtensionAPI, "exec">;
	const runtime = new RtkRuntime({ expectedSha256: "unused" });

	expect(await run(runtime.rewrite(pi, "git status"))).toBeUndefined();
	expect(await run(runtime.rewrite(pi, "git diff"))).toBeUndefined();
	expect(probes).toBe(1);
	expect(runtime.snapshot().state).toBe("unavailable");
});

test("fails open when the current platform has no certified binary identity", async () => {
	const binary = await fakeBinary();
	let rewriteCalls = 0;
	// SAFETY: this test controls the value and supplies every Pick member exercised by this case.
	const pi = {
		exec: async (command: string, args: string[]) => {
			if (command === "which") return result(`${binary.path}\n`);
			if (args[0] === "--version") return result(`rtk ${CERTIFIED_RTK_VERSION}\n`);
			if (args[0] === "rewrite") rewriteCalls += 1;
			return result("rtk git status\n", 3);
		},
	} as Pick<ExtensionAPI, "exec">;
	const runtime = new RtkRuntime({ platform: "darwin" });

	expect(await run(runtime.rewrite(pi, "git status"))).toBeUndefined();
	expect(rewriteCalls).toBe(0);
	expect(runtime.snapshot()).toMatchObject({ state: "unavailable" });
});

test("fails open on timeout and stops retrying the slow executable", async () => {
	const binary = await fakeBinary();
	let rewriteCalls = 0;
	// SAFETY: this test controls the value and supplies every Pick member exercised by this case.
	const pi = {
		exec: async (command: string, args: string[], options?: { signal?: AbortSignal }) => {
			if (command === "which") return result(`${binary.path}\n`);
			if (args[0] === "--version") return result(`rtk ${CERTIFIED_RTK_VERSION}\n`);
			if (args[0] === "rewrite") {
				rewriteCalls += 1;
				await new Promise<void>((_resolve, reject) => {
					options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
				});
			}
			return result("", 1);
		},
	} as Pick<ExtensionAPI, "exec">;
	const runtime = new RtkRuntime({ expectedSha256: binary.sha256, rewriteTimeoutMs: 5 });

	expect(await run(runtime.rewrite(pi, "git status"))).toBeUndefined();
	expect(await run(runtime.rewrite(pi, "git diff"))).toBeUndefined();
	expect(rewriteCalls).toBe(1);
	expect(runtime.snapshot()).toMatchObject({ lastError: "RTK rewrite timed out", state: "unavailable" });
});

test("deduplicates ordinary verification while serializing explicit refreshes", async () => {
	const binary = await fakeBinary();
	const releaseVersion = Promise.withResolvers<void>();
	let resolverCalls = 0;
	let versionCalls = 0;
	let waiting = true;
	// SAFETY: this test controls the value and supplies every Pick member exercised by this case.
	const pi = {
		exec: async (command: string, args: string[]) => {
			if (command === "which") {
				resolverCalls += 1;
				return result(`${binary.path}\n`);
			}
			if (args[0] === "--version") {
				versionCalls += 1;
				if (waiting) await releaseVersion.promise;
				return result(`rtk ${CERTIFIED_RTK_VERSION}\n`);
			}
			return result("", 1);
		},
	} as Pick<ExtensionAPI, "exec">;
	const runtime = new RtkRuntime({ expectedSha256: binary.sha256 });

	const first = run(runtime.verify(pi));
	const second = run(runtime.verify(pi));
	for (let attempt = 0; attempt < 20 && versionCalls === 0; attempt += 1) await Bun.sleep(1);
	expect(resolverCalls).toBe(1);
	expect(versionCalls).toBe(1);
	waiting = false;
	releaseVersion.resolve();
	expect((await Promise.all([first, second])).map(({ state }) => state)).toEqual(["ready", "ready"]);

	await Promise.all([run(runtime.verify(pi, { refresh: true })), run(runtime.verify(pi, { refresh: true }))]);
	expect(resolverCalls).toBe(3);
	expect(versionCalls).toBe(3);
});

test("reset invalidates an in-flight certification before it can publish", async () => {
	const binary = await fakeBinary();
	const releaseVersion = Promise.withResolvers<void>();
	let versionCalls = 0;
	// SAFETY: this test controls the value and supplies every Pick member exercised by this case.
	const pi = {
		exec: async (command: string, args: string[]) => {
			if (command === "which") return result(`${binary.path}\n`);
			if (args[0] === "--version") {
				versionCalls += 1;
				if (versionCalls === 1) await releaseVersion.promise;
				return result(`rtk ${CERTIFIED_RTK_VERSION}\n`);
			}
			return result("", 1);
		},
	} as Pick<ExtensionAPI, "exec">;
	const runtime = new RtkRuntime({ expectedSha256: binary.sha256 });
	const stale = run(runtime.verify(pi));
	for (let attempt = 0; attempt < 20 && versionCalls === 0; attempt += 1) await Bun.sleep(1);

	runtime.reset();
	releaseVersion.resolve();
	expect((await stale).state).toBe("unchecked");
	expect(runtime.snapshot().state).toBe("unchecked");
	expect((await run(runtime.verify(pi))).state).toBe("ready");
	expect(versionCalls).toBe(2);
});

test("interrupted certification stays unchecked and can be retried", async () => {
	const binary = await fakeBinary();
	let blockVersion = true;
	let versionCalls = 0;
	// SAFETY: this test controls the value and supplies every Pick member exercised by this case.
	const pi = {
		exec: async (command: string, args: string[], options?: { signal?: AbortSignal }) => {
			if (command === "which") return result(`${binary.path}\n`);
			if (args[0] === "--version") {
				versionCalls += 1;
				if (blockVersion) {
					await new Promise<void>((_resolve, reject) => {
						options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
					});
				}
				return result(`rtk ${CERTIFIED_RTK_VERSION}\n`);
			}
			return result("", 1);
		},
	} as Pick<ExtensionAPI, "exec">;
	const runtime = new RtkRuntime({ expectedSha256: binary.sha256 });
	const controller = new AbortController();
	const interrupted = Effect.runPromise(runtime.verify(pi), { signal: controller.signal });
	for (let attempt = 0; attempt < 20 && versionCalls === 0; attempt += 1) await Bun.sleep(1);
	controller.abort();

	await expect(interrupted).rejects.toThrow();
	expect(runtime.snapshot().state).toBe("unchecked");
	blockVersion = false;
	expect((await run(runtime.verify(pi))).state).toBe("ready");
	expect(versionCalls).toBe(2);
});

test("detects path and executable drift before running rewritten commands", async () => {
	const first = await fakeBinary("first");
	const second = await fakeBinary("second");
	let selectedPath = first.path;
	let rewriteCalls = 0;
	// SAFETY: this test controls the value and supplies every Pick member exercised by this case.
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

	expect(await run(runtime.rewrite(pi, "git status"))).toBe("rtk git status");
	selectedPath = second.path;
	expect(await run(runtime.rewrite(pi, "git diff"))).toBeUndefined();
	expect(rewriteCalls).toBe(1);
	expect(runtime.snapshot().state).toBe("drifted");
});

test("detects in-place binary drift and allows explicit re-certification", async () => {
	const binary = await fakeBinary("first");
	let expectedSha256 = binary.sha256;
	// SAFETY: this test controls the value and supplies every Pick member exercised by this case.
	const pi = {
		exec: async (command: string, args: string[]) => {
			if (command === "which") return result(`${binary.path}\n`);
			if (args[0] === "--version") return result(`rtk ${CERTIFIED_RTK_VERSION}\n`);
			if (args[0] === "rewrite") return result("rtk git status\n", 3);
			return result("", 1);
		},
	} as Pick<ExtensionAPI, "exec">;
	const runtime = new RtkRuntime({ expectedSha256 });

	expect(await run(runtime.rewrite(pi, "git status"))).toBeDefined();
	await writeFile(binary.path, "changed");
	expect(await run(runtime.rewrite(pi, "git status"))).toBeUndefined();
	expect(runtime.snapshot().state).toBe("drifted");

	expectedSha256 = createHash("sha256")
		.update(await readFile(binary.path))
		.digest("hex");
	const replacementRuntime = new RtkRuntime({ expectedSha256 });
	expect((await run(replacementRuntime.verify(pi, { refresh: true }))).state).toBe("ready");
});

test("does not rewrite empty or already-RTK commands", async () => {
	let calls = 0;
	// SAFETY: this test controls the value and supplies every Pick member exercised by this case.
	const pi = {
		exec: async () => {
			calls += 1;
			return result("", 1);
		},
	} as Pick<ExtensionAPI, "exec">;
	const runtime = new RtkRuntime();

	expect(await run(runtime.rewrite(pi, "  "))).toBeUndefined();
	expect(await run(runtime.rewrite(pi, "rtk git status"))).toBeUndefined();
	expect(await run(runtime.rewrite(pi, "CI=1 rtk git status"))).toBeUndefined();
	expect(calls).toBe(0);
});
