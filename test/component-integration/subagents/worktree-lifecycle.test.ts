import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	cleanupWorktrees,
	createWorktrees,
	diffWorktrees,
} from "../../../packages/pi-stuff/src/subagents/src/runs/shared/worktree.js";

interface TestRepository {
	root: string;
	repo: string;
	worktreesDir: string;
}

const temporaryRoots = new Set<string>();

afterEach(() => {
	for (const root of temporaryRoots) {
		fs.rmSync(root, { recursive: true, force: true });
	}
	temporaryRoots.clear();
});

function git(cwd: string, args: string[]): string {
	const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8" });
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}

function branchExists(repo: string, branch: string): boolean {
	const result = spawnSync("git", ["-C", repo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
		encoding: "utf-8",
	});
	return result.status === 0;
}

function onlyItem<T>(items: readonly T[]): T {
	const item = items[0];
	if (!item) throw new Error("expected one item");
	return item;
}

function createRepository(): TestRepository {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-worktree-lifecycle-"));
	temporaryRoots.add(root);
	const repo = path.join(root, "repo");
	const worktreesDir = path.join(root, "worktrees");
	fs.mkdirSync(repo, { recursive: true });
	fs.mkdirSync(worktreesDir, { recursive: true });
	git(repo, ["init", "--quiet"]);
	git(repo, ["config", "user.name", "Pi Stuff Test"]);
	git(repo, ["config", "user.email", "pi-stuff@example.invalid"]);
	git(repo, ["config", "commit.gpgSign", "false"]);
	fs.writeFileSync(path.join(repo, ".gitignore"), "ignored-output.txt\n", "utf-8");
	fs.writeFileSync(path.join(repo, "tracked.txt"), "base\n", "utf-8");
	git(repo, ["add", ".gitignore", "tracked.txt"]);
	git(repo, ["commit", "--quiet", "-m", "base"]);
	return { root, repo, worktreesDir };
}

test("removes only a verified clean worktree at the base commit", () => {
	const fixture = createRepository();
	const setup = createWorktrees(fixture.repo, "clean", 1, { baseDir: fixture.worktreesDir });
	const worktree = onlyItem(setup.worktrees);

	const report = cleanupWorktrees(setup);

	expect(report.state).toBe("complete");
	expect(report.pruned).toBe(true);
	expect(report.tasks[0]).toMatchObject({
		outcome: "removed",
		reason: "clean",
		worktreeRemoved: true,
		branchRemoved: true,
	});
	expect(fs.existsSync(worktree.path)).toBe(false);
	expect(branchExists(fixture.repo, worktree.branch)).toBe(false);
});

test("retains tracked modifications with an understandable status", () => {
	const fixture = createRepository();
	const setup = createWorktrees(fixture.repo, "tracked", 1, { baseDir: fixture.worktreesDir });
	const worktree = onlyItem(setup.worktrees);
	fs.appendFileSync(path.join(worktree.path, "tracked.txt"), "Agent edit\n", "utf-8");
	const diffs = diffWorktrees(setup, ["worker"], path.join(fixture.root, "diffs"));

	const report = cleanupWorktrees(setup);

	expect(diffs[0]?.filesChanged).toBe(1);
	expect(report.state).toBe("partial");
	expect(report.tasks[0]).toMatchObject({
		outcome: "retained",
		reason: "changes",
		worktreeRemoved: false,
		branchRemoved: false,
	});
	expect(report.tasks[0]?.message).toContain("tracked, staged, or untracked changes");
	expect(fs.readFileSync(path.join(worktree.path, "tracked.txt"), "utf-8")).toContain("Agent edit");
	expect(branchExists(fixture.repo, worktree.branch)).toBe(true);
});

test("retains untracked files instead of force-removing user data", () => {
	const fixture = createRepository();
	const setup = createWorktrees(fixture.repo, "untracked", 1, { baseDir: fixture.worktreesDir });
	const worktree = onlyItem(setup.worktrees);
	const untrackedPath = path.join(worktree.path, "agent-output.txt");
	fs.writeFileSync(untrackedPath, "keep me\n", "utf-8");

	const report = cleanupWorktrees(setup);

	expect(report.tasks[0]).toMatchObject({ outcome: "retained", reason: "changes" });
	expect(fs.readFileSync(untrackedPath, "utf-8")).toBe("keep me\n");
	expect(branchExists(fixture.repo, worktree.branch)).toBe(true);
});

test("retains ignored untracked files instead of treating them as disposable", () => {
	const fixture = createRepository();
	const setup = createWorktrees(fixture.repo, "ignored", 1, { baseDir: fixture.worktreesDir });
	const worktree = onlyItem(setup.worktrees);
	const ignoredPath = path.join(worktree.path, "ignored-output.txt");
	fs.writeFileSync(ignoredPath, "keep ignored output\n", "utf-8");

	const report = cleanupWorktrees(setup);

	expect(report.tasks[0]).toMatchObject({ outcome: "retained", reason: "changes" });
	expect(fs.readFileSync(ignoredPath, "utf-8")).toBe("keep ignored output\n");
	expect(branchExists(fixture.repo, worktree.branch)).toBe(true);
});

test("retains a clean worktree when the Agent created a commit", () => {
	const fixture = createRepository();
	const setup = createWorktrees(fixture.repo, "committed", 1, { baseDir: fixture.worktreesDir });
	const worktree = onlyItem(setup.worktrees);
	fs.appendFileSync(path.join(worktree.path, "tracked.txt"), "committed Agent edit\n", "utf-8");
	git(worktree.path, ["add", "tracked.txt"]);
	git(worktree.path, ["commit", "--quiet", "-m", "Agent commit"]);

	const report = cleanupWorktrees(setup);

	expect(report.tasks[0]).toMatchObject({
		outcome: "retained",
		reason: "commits",
		worktreeRemoved: false,
		branchRemoved: false,
	});
	expect(report.tasks[0]?.message).toContain("Agent created commits");
	expect(fs.existsSync(worktree.path)).toBe(true);
	expect(branchExists(fixture.repo, worktree.branch)).toBe(true);
});

test("retains the directory and branch when Git cannot verify state", () => {
	const fixture = createRepository();
	const setup = createWorktrees(fixture.repo, "unknown", 1, { baseDir: fixture.worktreesDir });
	const worktree = onlyItem(setup.worktrees);
	fs.writeFileSync(path.join(worktree.path, ".git"), "gitdir: /definitely/missing/pi-stuff-worktree\n", "utf-8");

	const report = cleanupWorktrees(setup);

	expect(report.state).toBe("partial");
	expect(report.pruned).toBe(false);
	expect(report.tasks[0]).toMatchObject({
		outcome: "retained",
		reason: "git-check-failed",
		worktreeRemoved: false,
		branchRemoved: false,
	});
	expect(report.tasks[0]?.message).toContain("could not verify");
	expect(report.tasks[0]?.errors?.[0]).toContain("Git status check failed");
	expect(fs.existsSync(worktree.path)).toBe(true);
	expect(branchExists(fixture.repo, worktree.branch)).toBe(true);
});

test("does not destroy hook output when worktree setup fails", () => {
	const fixture = createRepository();
	const hookPath = path.join(fixture.root, "failing-hook.sh");
	fs.writeFileSync(
		hookPath,
		"#!/bin/sh\nprintf 'preserve hook output\\n' > agent-hook-output.txt\nprintf 'setup failed\\n' >&2\nexit 7\n",
		"utf-8",
	);
	fs.chmodSync(hookPath, 0o755);

	let setupError: unknown;
	try {
		createWorktrees(fixture.repo, "hook-failure", 1, {
			baseDir: fixture.worktreesDir,
			setupHook: { hookPath },
		});
	} catch (error) {
		setupError = error;
	}

	const retainedPath = path.join(fixture.worktreesDir, "pi-worktree-hook-failure-0");
	expect(setupError).toBeInstanceOf(Error);
	expect(String(setupError)).toContain("Retained because tracked, staged, or untracked changes exist");
	expect(fs.readFileSync(path.join(retainedPath, "agent-hook-output.txt"), "utf-8")).toBe("preserve hook output\n");
	expect(branchExists(fixture.repo, "pi-parallel-hook-failure-0")).toBe(true);
});

test("refuses to remove a synthetic path through a symlinked ancestor", () => {
	const fixture = createRepository();
	const hookPath = path.join(fixture.root, "synthetic-hook.sh");
	fs.writeFileSync(
		hookPath,
		'#!/bin/sh\nmkdir -p cache/output\nprintf \'{"syntheticPaths":["cache/output"]}\\n\'\n',
		"utf-8",
	);
	fs.chmodSync(hookPath, 0o755);
	const setup = createWorktrees(fixture.repo, "synthetic-symlink", 1, {
		baseDir: fixture.worktreesDir,
		setupHook: { hookPath },
	});
	const worktree = onlyItem(setup.worktrees);
	const outside = path.join(fixture.root, "outside");
	const outsideOutput = path.join(outside, "output");
	fs.mkdirSync(outsideOutput, { recursive: true });
	const sentinel = path.join(outsideOutput, "keep.txt");
	fs.writeFileSync(sentinel, "must survive\n", "utf-8");
	fs.rmSync(path.join(worktree.path, "cache"), { recursive: true, force: true });
	fs.symlinkSync(outside, path.join(worktree.path, "cache"), "dir");

	const [diff] = diffWorktrees(setup, ["worker"], path.join(fixture.root, "diffs"));

	expect(diff?.error).toContain("symbolic-link ancestor");
	expect(fs.readFileSync(sentinel, "utf-8")).toBe("must survive\n");
	const report = cleanupWorktrees(setup);
	expect(report.tasks[0]).toMatchObject({ outcome: "retained", reason: "changes" });
	expect(fs.readFileSync(sentinel, "utf-8")).toBe("must survive\n");
});
