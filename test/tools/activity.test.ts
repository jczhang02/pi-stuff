import { expect, test } from "bun:test";
import {
	type ActivitySummaryMember,
	activityTarget,
	classifyBashActivity,
	planToolActivityGroups,
	summarizeToolActivityGroup,
} from "../../packages/pi-stuff/src/tool-display/activity.js";

const owned = new Set(["read", "edit", "bash"]);

const call = (id: string, name: string, value: string) => ({
	type: "toolCall",
	id,
	name,
	arguments: { value },
});

const assistant = (...content: unknown[]) => ({ role: "assistant", content });

test("active path targets preserve only the nearest useful directory and basename", () => {
	expect(activityTarget("/workspace/pi-stuff/packages/pi-stuff/src/tool-display/contract.ts")).toBe(
		"/⋯/tool-display/contract.ts",
	);
	expect(activityTarget("packages/pi-stuff/src/tool-display/contract.ts")).toBe("⋯/tool-display/contract.ts");
	expect(activityTarget("Running repository checks")).toBe("Running repository checks");
});

test("plans one complete group across Tool round-trips and visible Thinking", () => {
	const groups = planToolActivityGroups(
		[
			{ role: "user", content: [{ type: "text", text: "work" }] },
			assistant({ type: "thinking", thinking: "inspect" }, call("r1", "read", "a")),
			{ role: "toolResult", toolCallId: "r1", content: [{ type: "text", text: "A" }], details: {} },
			assistant({ type: "thinking", thinking: "change" }, call("e1", "edit", "a")),
			{ role: "toolResult", toolCallId: "e1", content: [{ type: "text", text: "ok" }], details: {} },
			assistant({ type: "thinking", thinking: "verify" }, call("b1", "bash", "test")),
		],
		owned,
		false,
	);

	expect(groups).toHaveLength(1);
	expect(groups[0]?.leaderId).toBe("r1");
	expect(groups[0]?.closed).toBe(false);
	expect(groups[0]?.members.map((member) => member.id)).toEqual(["r1", "e1", "b1"]);
	expect(groups[0]?.members[0]?.result?.content).toEqual([{ type: "text", text: "A" }]);
});

test("branch and compaction metadata stay transparent to Activity Groups", () => {
	const groups = planToolActivityGroups(
		[
			assistant(call("r1", "read", "a")),
			{ role: "branchSummary", summary: "branch metadata" },
			{ role: "compactionSummary", summary: "compaction metadata" },
			assistant(call("e1", "edit", "a")),
		],
		owned,
		true,
	);
	expect(groups.map((group) => group.members.map((entry) => entry.id))).toEqual([["r1", "e1"]]);
});

test("prose, visible context, user input, and unknown Tools are boundaries", () => {
	const groups = planToolActivityGroups(
		[
			assistant(call("r1", "read", "a"), { type: "text", text: "I found it." }, call("e1", "edit", "a")),
			assistant(call("x1", "third_party", "x"), call("b1", "bash", "test")),
			{ role: "custom", display: false, content: "hidden" },
			assistant(call("r2", "read", "b")),
			{ role: "custom", display: true, content: "visible notification" },
			assistant(call("r3", "read", "c")),
			{ role: "user", content: [{ type: "text", text: "next" }] },
		],
		owned,
		false,
	);

	expect(groups.map((group) => group.members.map((member) => member.id))).toEqual([
		["r1"],
		["e1"],
		["b1", "r2"],
		["r3"],
	]);
	expect(groups.every((group) => group.closed)).toBe(true);
});

test("a singleton forms a group and historical tails close deterministically", () => {
	const [group] = planToolActivityGroups([assistant(call("r1", "read", "a"))], owned, true);
	expect(group?.members).toHaveLength(1);
	expect(group?.closed).toBe(true);
});

test("assistant lifecycle failures settle calls that never received Tool results", () => {
	const groups = planToolActivityGroups(
		[
			{ ...assistant(call("cancelled", "read", "a")), stopReason: "aborted" },
			{ ...assistant(call("failed", "read", "b")), stopReason: "error" },
			{ ...assistant(call("completed", "read", "c")), stopReason: "aborted" },
			{ role: "toolResult", toolCallId: "completed", content: [{ type: "text", text: "done" }], details: {} },
		],
		owned,
		true,
	);

	expect(groups[0]?.members[0]?.terminalState).toBe("cancelled");
	expect(groups[0]?.members[1]?.terminalState).toBe("error");
	expect(groups[0]?.members[2]?.terminalState).toBeUndefined();
	expect(groups[0]?.members[2]?.result).toBeDefined();
});

function member(state: ActivitySummaryMember["state"], items: ActivitySummaryMember["items"]): ActivitySummaryMember {
	return { items, state };
}

function recoverableMember(
	state: ActivitySummaryMember["state"],
	key: string,
	items: ActivitySummaryMember["items"] = [],
): ActivitySummaryMember {
	return { items, recoveryKeys: [key], state };
}

test("summarizes semantic categories in fixed order with object deduplication", () => {
	const summary = summarizeToolActivityGroup(
		[
			member("success", [{ category: "read-file", countKeys: ["/a.ts"], target: "a.ts" }]),
			member("success", [{ category: "run-command", count: 1, target: "Running tests" }]),
			member("success", [{ category: "change-file", countKeys: ["/a.ts", "/b.ts"] }]),
			member("success", [{ category: "read-file", countKeys: ["/a.ts", "/c.ts"] }]),
		],
		true,
	);

	expect(summary.summary).toBe("Changed 2 files, ran 1 command, read 2 files");
	expect(summary.target).toBe("");
	expect(summary.active).toBe(false);
});

test("Bash outcomes are success-gated and expose bounded Git identities", () => {
	const failed = classifyBashActivity({
		args: { command: "git push origin main" },
		result: { content: [{ type: "text", text: "rejected" }], details: {} },
		state: "error",
	});
	expect(failed.map((item) => item.category)).toEqual(["run-command"]);

	const pullRequest = classifyBashActivity({
		args: { command: "gh pr create" },
		result: { content: [{ type: "text", text: "https://github.com/acme/repo/pull/42" }], details: {} },
		state: "success",
	});
	expect(pullRequest).toEqual([expect.objectContaining({ category: "create-pr", detail: "#42" })]);

	const merge = classifyBashActivity({
		args: { command: "git merge feature" },
		result: { content: [{ type: "text", text: "Fast-forward" }], details: {} },
		state: "success",
	});
	expect(merge).toEqual([expect.objectContaining({ category: "merge", detail: "feature" })]);
	const rebase = classifyBashActivity({
		args: { command: "git rebase main" },
		result: { content: [{ type: "text", text: "Successfully rebased and updated refs/heads/topic." }], details: {} },
		state: "success",
	});
	expect(rebase).toEqual([expect.objectContaining({ category: "rebase", detail: "main" })]);

	for (const command of ["git merge feature || true", "git rebase main | cat", "git merge --abort"]) {
		const masked = classifyBashActivity({
			args: { command },
			result: { content: [{ type: "text", text: "Fast-forward\nSuccessfully rebased" }], details: {} },
			state: "success",
		});
		expect(masked.map((item) => item.category)).toEqual(["run-command"]);
	}

	for (const command of ["git commit --dry-run", "git push --dry-run origin main", "gh pr create --dry-run"]) {
		const dryRun = classifyBashActivity({
			args: { command },
			result: { content: [{ type: "text", text: "dry run" }], details: {} },
			state: "success",
		});
		expect(dryRun.map((item) => item.category)).toEqual(["run-command"]);
	}

	const commitWithoutEvidence = classifyBashActivity({
		args: { command: "git commit -m test" },
		result: { content: [{ type: "text", text: "nothing to commit" }], details: {} },
		state: "success",
	});
	expect(commitWithoutEvidence.map((item) => item.category)).toEqual(["run-command"]);
});

test("uses present tense, latest bounded target, structured outcomes, and honest issues", () => {
	const active = summarizeToolActivityGroup(
		[
			member("success", [{ category: "commit", count: 1, detail: "cf12251" }]),
			member("error", [{ category: "run-command", count: 1, target: "Typechecking" }]),
			member("rejected", [{ category: "read-file", countKeys: ["/secret"] }]),
			member("cancelled", []),
		],
		false,
	);

	expect(active.summary).toBe(
		"Committing 1 change, running 1 command, reading 1 file · 1 failed, 1 rejected, 1 cancelled",
	);
	expect(active.target).toBe("Typechecking");
	expect(active.issueState).toBe("error");

	const settled = summarizeToolActivityGroup(
		[member("success", [{ category: "commit", count: 1, detail: "cf12251" }])],
		true,
	);
	expect(settled.summary).toBe("Committed cf12251");
});

test("successful infrastructure-only groups are silent but issues remain visible", () => {
	expect(summarizeToolActivityGroup([member("success", [])], true).summary).toBe("");
	expect(summarizeToolActivityGroup([member("error", [])], true).summary).toBe("Internal operation failed");
});

test("derives effective outcomes only from success, exact recovery, and explicit issues", () => {
	const success = member("success", [{ category: "read-file", countKeys: ["a.ts"] }]);
	const failure = recoverableMember("error", "retry\u0000a", [{ category: "run-command", count: 1 }]);
	const retry = recoverableMember("success", "retry\u0000a", [{ category: "run-command", count: 1 }]);

	expect(summarizeToolActivityGroup([member("running", [])], false).outcome).toBe("running");
	expect(summarizeToolActivityGroup([success], true).outcome).toBe("success");
	expect(summarizeToolActivityGroup([failure, retry], true)).toMatchObject({
		issueText: "1 failed",
		outcome: "success",
	});
	expect(summarizeToolActivityGroup([success, failure], true).outcome).toBe("warning");
	expect(summarizeToolActivityGroup([failure, recoverableMember("success", "retry\u0000b")], true).outcome).toBe(
		"error",
	);
	expect(summarizeToolActivityGroup([failure], true).outcome).toBe("error");
	expect(summarizeToolActivityGroup([member("rejected", [])], true).outcome).toBe("warning");
	expect(summarizeToolActivityGroup([member("cancelled", [])], true).outcome).toBe("warning");
});
