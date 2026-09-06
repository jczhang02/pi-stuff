import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildVerificationPlan } from "../../../scripts/verification-plan.ts";

async function repo(): Promise<{ root: string; base: string }> {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-plan-"));
	await mkdir(join(root, "test/unit/alpha"), { recursive: true });
	await writeFile(
		join(root, "test/unit/alpha/alpha.test.ts"),
		'import { test } from "bun:test"; test("alpha", () => {});\n',
	);
	await writeFile(join(root, "README.md"), "one\n");
	const run = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root, stdout: "ignore", stderr: "ignore" });
	run(["init", "-q"]);
	run(["config", "user.email", "test@example.invalid"]);
	run(["config", "user.name", "test"]);
	run(["add", "."]);
	run(["commit", "-qm", "initial"]);
	const base = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim();
	return { root, base };
}

describe("verification plan", () => {
	test("pure metadata changes require no tests", async () => {
		const { root, base } = await repo();
		try {
			await writeFile(join(root, "README.md"), "two\n");
			const plan = buildVerificationPlan(root, { VERIFY_BASE: base });
			expect(plan.mode).toBe("none");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("invalid base falls back to all tests", async () => {
		const { root } = await repo();
		try {
			const plan = buildVerificationPlan(root, { VERIFY_BASE: "bad-base" });
			expect(plan.mode).toBe("all");
			expect(plan.reason).toContain("invalid");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
