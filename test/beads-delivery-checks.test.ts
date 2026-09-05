import { expect, test } from "bun:test";
import { verifyDeliveryChecks } from "../scripts/beads-delivery-checks.ts";

const SHA = "a".repeat(40);
const CODE = ["packages/pi-stuff/index.ts"];
const DOCS = ["packages/pi-stuff/README.md"];

function fixture() {
	const current = {
		id: 20,
		path: ".github/workflows/ci.yml",
		head_sha: SHA,
		event: "pull_request",
		status: "completed",
		conclusion: "success",
		run_number: 10,
		run_attempt: 2,
	};
	const runs = [current];
	const jobs = [
		{ name: "Fast", status: "completed", conclusion: "success" },
		{ name: "Acceptance", status: "completed", conclusion: "success" },
	];
	const calls: string[][] = [];
	const run = (command: readonly string[]): string => {
		calls.push([...command]);
		if (command[2]?.includes("actions/workflows/ci.yml/runs"))
			return JSON.stringify([{ workflow_runs: runs.slice(0, 1) }, { workflow_runs: runs.slice(1) }]);
		if (command[2]?.includes("actions/runs/20/attempts/2/jobs"))
			return JSON.stringify([{ jobs: jobs.slice(0, 1) }, { jobs: jobs.slice(1) }]);
		throw new Error(`Unexpected request: ${command.join(" ")}`);
	};
	return {
		current,
		runs,
		jobs,
		calls,
		check: (paths: readonly string[] | undefined) => verifyDeliveryChecks("example/suite", SHA, paths, run),
	};
}

test("verification binds the workflow, commit, latest run and attempt across pages", () => {
	const f = fixture();
	f.runs.push({ ...f.current, id: 19, run_number: 9, conclusion: "failure" });
	expect(f.check(CODE).join(" ")).toContain("/actions/runs/20/attempts/2");
	expect(f.calls.every((call) => call.includes("--paginate") && call.includes("--slurp"))).toBeTrue();
	f.current.conclusion = "failure";
	f.runs[1] = { ...f.current, id: 19, run_number: 9, conclusion: "success" };
	expect(() => f.check(CODE)).toThrow("incomplete or unsuccessful");
});

test("missing or unrelated workflow evidence never certifies delivery", () => {
	for (const mode of ["absent", "path", "sha", "event", "queued", "unknown"] as const) {
		const f = fixture();
		if (mode === "absent") f.runs.length = 0;
		if (mode === "path") f.current.path = ".github/workflows/pretend-ci.yml";
		if (mode === "sha") f.current.head_sha = "b".repeat(40);
		if (mode === "event") f.current.event = "push";
		if (mode === "queued") f.current.status = "queued";
		if (mode === "unknown") f.current.conclusion = "unknown";
		expect(() => f.check(CODE)).toThrow("CI verification failed");
	}
});

test("each required job must have one completed successful result", () => {
	for (const name of ["Fast", "Acceptance"]) {
		for (const mode of ["missing", "duplicate", "failure", "skipped", "running"]) {
			const f = fixture();
			const index = f.jobs.findIndex((job) => job.name === name);
			if (mode === "missing") f.jobs.splice(index, 1);
			else if (mode === "duplicate") f.jobs.push({ name, status: "completed", conclusion: "success" });
			else f.jobs[index] = { name, status: mode === "running" ? "in_progress" : "completed", conclusion: mode };
			expect(() => f.check(CODE)).toThrow(`${name} is missing, incomplete, or unsuccessful`);
		}
	}
});

test("prose PRs and direct pushes retain Fast-only policy; dispatch and unknown impact require Acceptance", () => {
	const f = fixture();
	f.jobs.splice(1);
	expect(f.check(DOCS).join(" ")).toContain("Fast passed");
	expect(() => f.check([])).toThrow("Acceptance");
	f.current.event = "push";
	expect(f.check(undefined).join(" ")).toContain("Fast passed");
	f.current.event = "pull_request";
	expect(() => f.check(undefined)).toThrow("no matching workflow");
	f.current.event = "workflow_dispatch";
	expect(() => f.check(DOCS)).toThrow("Acceptance");
	expect(() => f.check(undefined)).toThrow("Acceptance");
});
