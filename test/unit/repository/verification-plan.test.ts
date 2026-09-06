import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildVerificationPlan } from "../../../scripts/verification-plan.ts";

function git(root: string, args: string[]): string {
	const result = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], { cwd: root });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}
async function put(root: string, path: string, text: string): Promise<void> {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), text);
}
async function repo(): Promise<{ root: string; base: string }> {
	const root = await mkdtemp(join(tmpdir(), "pi-stuff-plan-"));
	await mkdir(join(root, "test/unit/alpha"), { recursive: true });
	await writeFile(
		join(root, "test/unit/alpha/alpha.test.ts"),
		'import { test } from "bun:test"; test("alpha", () => {});\n',
	);
	await writeFile(join(root, "README.md"), "one\n");
	await put(root, "packages/pi-stuff/suite.json", JSON.stringify({ capabilities: ["alpha", "beta", "gamma"] }));
	await put(root, "packages/pi-stuff/src/alpha/value.ts", "export const value = 1;");
	await put(root, "packages/pi-stuff/src/beta/use.ts", 'import "../alpha/value.js";');
	await put(root, "test/helpers/bridge.ts", 'export * from "../../packages/pi-stuff/src/beta/use.js";');
	await put(root, "test/unit/beta/beta.test.ts", 'import "../../helpers/bridge.js";');
	await put(root, "test/unit/gamma/gamma.test.ts", "// unrelated");
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "test@example.invalid"]);
	git(root, ["config", "user.name", "test"]);
	git(root, ["add", "."]);
	git(root, ["commit", "-qm", "initial"]);
	const base = git(root, ["rev-parse", "HEAD"]);
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

	test("local scope unions committed, staged, unstaged, and untracked paths", async () => {
		const { root, base } = await repo();
		try {
			await writeFile(join(root, "committed.ts"), "export const committed = 1;\n");
			Bun.spawnSync(["git", "add", "committed.ts"], { cwd: root });
			Bun.spawnSync(["git", "commit", "-qm", "change"], { cwd: root });
			await writeFile(join(root, "committed.ts"), "export const committed = 2;\n");
			await writeFile(join(root, "untracked.ts"), "export const untracked = 1;\n");
			const plan = buildVerificationPlan(root, { VERIFY_BASE: base });
			expect(plan.changedFiles).toEqual(["committed.ts", "untracked.ts"]);
			expect(plan.mode).toBe("all");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("removed executable markdown is not metadata-only", async () => {
		const { root, base } = await repo();
		try {
			await writeFile(join(root, "README.md"), "~~~bash\necho unsafe\n~~~\n");
			Bun.spawnSync(["git", "add", "README.md"], { cwd: root });
			Bun.spawnSync(["git", "commit", "-qm", "docs"], { cwd: root });
			Bun.spawnSync(["git", "rm", "-q", "README.md"], { cwd: root });
			const plan = buildVerificationPlan(root, { VERIFY_BASE: base });
			expect(plan.mode).toBe("all");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

test("Capability selection follows side-effect imports and transitive test helpers", async () => {
	const { root, base } = await repo();
	try {
		await put(root, "packages/pi-stuff/src/alpha/value.ts", "export const value = 2;");
		const selected = buildVerificationPlan(root, { VERIFY_BASE: "HEAD" });
		expect(selected.mode).toBe("selected");
		expect(selected.files).toEqual(["test/unit/alpha/alpha.test.ts", "test/unit/beta/beta.test.ts"]);
		await put(root, "mystery.txt", "unknown");
		expect(buildVerificationPlan(root, { VERIFY_BASE: base }).mode).toBe("all");
		await rm(join(root, "mystery.txt"));
		await put(root, "README.md", "```custom\nrun it\n```");
		expect(buildVerificationPlan(root, { VERIFY_BASE: base }).mode).toBe("all");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("local range retains staged edits undone in worktree and committed paths", async () => {
	const { root, base } = await repo();
	try {
		await put(root, "committed.md", "prose");
		git(root, ["add", "."]);
		git(root, ["commit", "-qm", "committed"]);
		await put(root, "README.md", "staged");
		git(root, ["add", "README.md"]);
		await put(root, "README.md", "one\n");
		await put(root, "unstaged.md", "new");
		git(root, ["add", "unstaged.md"]);
		await put(root, "untracked.md", "new");
		expect(buildVerificationPlan(root, { VERIFY_BASE: base }).changedFiles).toEqual([
			"README.md",
			"committed.md",
			"unstaged.md",
			"untracked.md",
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("CI ranges fail closed, while push and PR use committed changes", async () => {
	const { root, base } = await repo();
	try {
		const ci = { VERIFICATION_PLAN_CI: "1", GITHUB_EVENT_NAME: "push", CI_BASE_SHA: base };
		expect(buildVerificationPlan(root, { VERIFY_BASE: base }).mode).toBe("all");
		await put(root, "README.md", "pure prose");
		git(root, ["add", "."]);
		git(root, ["commit", "-qm", "docs"]);
		const head = git(root, ["rev-parse", "HEAD"]);
		expect(buildVerificationPlan(root, ci).mode).toBe("all");
		for (const event of ["push", "pull_request"])
			expect(buildVerificationPlan(root, { ...ci, GITHUB_EVENT_NAME: event, CI_HEAD_SHA: head }).mode).toBe("none");
		expect(
			buildVerificationPlan(root, { ...ci, GITHUB_EVENT_NAME: "workflow_dispatch", CI_HEAD_SHA: head }).mode,
		).toBe("all");
		await put(root, ".beads/executable.sh", "echo hello");
		expect(buildVerificationPlan(root, { VERIFY_BASE: base }).mode).toBe("all");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("planner help and invalid arguments leave no artifact", async () => {
	const { root } = await repo();
	try {
		const script = resolve("scripts/verification-plan.ts");
		for (const [args, status] of [
			[["--help"], 0],
			[["--unknown"], 1],
		] as const) {
			const result = Bun.spawnSync([process.execPath, script, ...args], { cwd: root });
			expect(result.exitCode).toBe(status);
			expect(await Bun.file(join(root, ".artifacts/verification-plan.json")).exists()).toBe(false);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("imports outside the analyzed graph force complete verification", async () => {
	const { root } = await repo();
	try {
		await put(root, "scripts/bridge.ts", 'export * from "../packages/pi-stuff/src/alpha/value.js";');
		await put(root, "test/unit/gamma/gamma.test.ts", 'import "../../../scripts/bridge.js";');
		git(root, ["add", "."]);
		git(root, ["commit", "-qm", "shared helper"]);
		await put(root, "packages/pi-stuff/src/alpha/value.ts", "export const value = 2;");
		expect(buildVerificationPlan(root, { VERIFY_BASE: "HEAD" }).mode).toBe("all");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
