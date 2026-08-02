import { describe, expect, test } from "bun:test";
import { BashProgram } from "../../packages/pi-stuff-permissions/src/access-intent/bash/program.js";
import {
	type CircuitBreakerDecision,
	classifyDestructiveCommand,
} from "../../packages/pi-stuff-permissions/src/destructive-command.js";
import { resolveBashCommandCheck } from "../../packages/pi-stuff-permissions/src/handlers/gates/bash-command.js";
import type { GateResult } from "../../packages/pi-stuff-permissions/src/handlers/gates/descriptor.js";
import type { GateRunner } from "../../packages/pi-stuff-permissions/src/handlers/gates/runner.js";
import { ToolCallGatePipeline } from "../../packages/pi-stuff-permissions/src/handlers/gates/tool-call-gate-pipeline.js";
import { posixPathFlavor, win32PathFlavor } from "../../packages/pi-stuff-permissions/src/path/path-flavor.js";
import { PathNormalizer } from "../../packages/pi-stuff-permissions/src/path-normalizer.js";

const CWD = "/workspace/project";
const HOME = "/home/tester";
const normalizer = new PathNormalizer(posixPathFlavor, CWD);

async function classify(command: string): Promise<CircuitBreakerDecision> {
	const program = await BashProgram.parse(command, normalizer);
	return classifyDestructiveCommand(program, normalizer, {
		cwd: CWD,
		homeDirectory: HOME,
		gitWorktreeRoot: CWD,
	});
}

async function expectAction(action: CircuitBreakerDecision["action"], commands: readonly string[]): Promise<void> {
	for (const command of commands) {
		expect((await classify(command)).action, command).toBe(action);
	}
}

describe("destructive command circuit breaker", () => {
	test("leaves ordinary work and explicit in-project deletion uninterrupted", async () => {
		await expectAction("allow", [
			"echo ok",
			"$CMD --version",
			"$(printf echo) ok",
			"cd /tmp; $CMD --version",
			"env FOO=1 npm test",
			"timeout 30 bun test",
			'bash -lc "pwd"',
			"bash -lc 'git switch main'",
			"bash -lc 'git stash list'",
			"bash -lc 'echo stash clear'",
			"bash -lc 'printf switch --force'",
			"bash -lc 'echo reset --hard'",
			"bash -lc 'echo clean'",
			`bash -lc 'echo rm -rf ${HOME}'`,
			"bash -lc 'git help reset --hard'",
			"bash -lc \"git log --format='stash clear'\"",
			"rm file.txt",
			"rm -rf src/generated",
			"rm -- 'literal*name'",
			"find src/generated -type f -delete",
			"git status",
			"git clean -nfd",
			"git checkout feature/topic",
		]);
	});

	test("does not reintroduce prompts for ordinary wrappers in unrestricted mode", async () => {
		const resolver = {
			resolve: () => ({
				state: "allow" as const,
				toolName: "bash",
				source: "bash" as const,
				origin: "builtin" as const,
			}),
		};
		for (const command of [
			"env FOO=1 npm test",
			"timeout 30 bun test",
			'bash -lc "pwd"',
			"find . -exec echo {} \\;",
		]) {
			const program = await BashProgram.parse(command, normalizer);
			expect(resolveBashCommandCheck(command, program.commands(), undefined, resolver).state, command).toBe("allow");
		}
	});

	test("asks once for concrete outside deletion and Git worktree discard", async () => {
		await expectAction("ask", [
			"rm ../outside.txt",
			"unlink /var/tmp/output.txt",
			"find /var/tmp/generated -type f -delete",
			"git reset --hard",
			"git reset --h\\ard",
			"git reset $'--hard'",
			"git clean -fd",
			"git restore src/app.ts",
			"git checkout .",
			"git checkout HEAD src/app.ts",
			"git switch --discard-changes main",
			"git stash clear",
		]);
	});

	test("denies filesystem, home, cwd, worktree, metadata, and ancestor targets", async () => {
		await expectAction("deny", [
			"rm -rf /",
			`rm -rf ${HOME}`,
			`rm -rf ${CWD}`,
			`rm -rf ${CWD}/.git`,
			"rm -rf .",
			"rm -rf ..",
			"rm -rf /workspace",
		]);
	});

	test("decodes shell-equivalent spellings before classifying", async () => {
		await expectAction("deny", [
			`r\\m -rf ${HOME}`,
			`r""m -rf ${HOME}`,
			`$'rm' -rf ${HOME}`,
			`rm -rf $'${HOME}'`,
			"f\\ind -mindepth 1 -delete",
		]);
	});

	test("denies ambiguous targets, wrappers, executables, and directory state", async () => {
		await expectAction("deny", [
			"rm -rf *",
			"rm -rf $TARGET",
			"rm -rf $(pwd)/generated",
			"rm -rf {one,two}",
			`sudo rm -rf ${HOME}`,
			`busybox rm -rf ${HOME}`,
			`toybox rm -rf ${HOME}`,
			`ionice rm -rf ${HOME}`,
			`CMD=rm; $CMD -rf ${HOME}`,
			`$(printf rm) -rf ${HOME}`,
			"bash -lc 'git stash clear'",
			"eval 'git stash drop'",
			"bash -lc 'git switch --discard-changes main'",
			"cd -; rm -rf .",
			"cd /definitely-missing; rm -rf .",
			"pushd /; rm -rf tmp",
			`rmdir -p ${CWD}/empty/a`,
		]);
	});

	test("treats find's implicit root as cwd", async () => {
		await expectAction("deny", [
			"find -delete",
			"find -mindepth 1 -delete",
			"find -maxdepth 1 -delete",
			'find -name "*" -delete',
			"find -type f -delete",
		]);
	});

	test("denies malformed destructive syntax but not malformed ordinary text", async () => {
		expect((await classify("rm 'unterminated")).action).toBe("deny");
		expect((await classify("echo 'unterminated")).action).toBe("allow");
	});

	test("denies any Windows/MSYS drive root, not only cwd's drive", async () => {
		const windowsCwd = "C:\\repo";
		const windowsNormalizer = new PathNormalizer(win32PathFlavor, windowsCwd);
		const program = await BashProgram.parse("rm -rf /d", windowsNormalizer);
		expect(
			classifyDestructiveCommand(program, windowsNormalizer, {
				cwd: windowsCwd,
				homeDirectory: "C:\\Users\\tester",
				gitWorktreeRoot: windowsCwd,
			}).action,
		).toBe("deny");
	});

	test("binds a custom shell tripwire to that tool's real working directory", async () => {
		let observedTripwire: { cwd: string; targets: string[] } | undefined;
		const pipeline = new ToolCallGatePipeline(
			{
				resolve: () => ({
					state: "allow",
					toolName: "exec_command",
					source: "tool",
					origin: "builtin",
				}),
			},
			{
				getActiveSkillEntries: () => [],
				getInfrastructureReadDirs: () => [],
				getPathNormalizer: () => normalizer,
				getShellToolAliases: () => ({
					exec_command: { commandArgument: "cmd", workdirArgument: "workdir" },
				}),
				getToolPreviewLimits: () => ({
					toolInputPreviewMaxLength: 200,
					toolTextSummaryMaxLength: 80,
					toolInputLogPreviewMaxLength: 500,
				}),
			},
		);
		const runner = {
			async run(gate: GateResult) {
				if (gate && !("action" in gate) && gate.promptDetails.tripwire) {
					observedTripwire = gate.promptDetails.tripwire;
					return { action: "block" as const, reason: "captured" };
				}
				return { action: "allow" as const };
			},
		} as unknown as GateRunner;
		const context = {
			toolName: "exec_command",
			agentName: null,
			toolCallId: "workdir-tripwire",
			cwd: CWD,
		};

		await pipeline.evaluate({ ...context, input: { cmd: "rm ../outside.txt", workdir: "/var/tmp/job" } }, runner);
		expect(observedTripwire).toMatchObject({
			cwd: "/var/tmp/job",
			targets: ["/var/tmp/outside.txt"],
		});

		observedTripwire = undefined;
		const inside = await pipeline.evaluate(
			{ ...context, input: { cmd: "rm output.txt", workdir: "/var/tmp/job" } },
			runner,
		);
		expect(inside).toEqual({ action: "allow" });
		expect(observedTripwire).toBeUndefined();
	});
});
