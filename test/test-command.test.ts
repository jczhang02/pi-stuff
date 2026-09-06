import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const runner = resolve(import.meta.dirname, "../scripts/run-isolated-tests.ts");

test("test preview selects files without executing them and rejects empty selections", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-stuff-test-command-"));
	try {
		await mkdir(join(cwd, "test"));
		await writeFile(join(cwd, "test/sentinel.test.ts"), 'throw new Error("scenario executed");\n');
		await mkdir(join(cwd, "test/goal-upstream"));
		await writeFile(join(cwd, "test/goal-upstream/command.node.ts"), 'throw new Error("Node scenario executed");\n');
		await writeFile(join(cwd, "test/goal-upstream/goal-runtime-smoke.mjs"), 'throw new Error("smoke executed");\n');
		const all = Bun.spawnSync([process.execPath, runner, "--list"], { cwd });
		expect(all.stdout.toString()).toContain("test/goal-upstream/command.node.ts");
		expect(all.stdout.toString()).toContain("test/goal-upstream/goal-runtime-smoke.mjs");
		const preview = Bun.spawnSync([process.execPath, runner, "--list", "--file", "sentinel"], { cwd });
		expect(preview.exitCode).toBe(0);
		expect(preview.stdout.toString()).toContain("test/sentinel.test.ts");
		expect(preview.stderr.toString()).not.toContain("scenario executed");
		for (const args of [["--unknown"], ["--file", "missing"]]) {
			const result = Bun.spawnSync([process.execPath, runner, ...args], { cwd });
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).not.toContain("scenario executed");
		}
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
