import { Type } from "typebox";
import { Check } from "typebox/value";
import { requiresFullAcceptance } from "./ci-acceptance-scope.ts";

const RUN = Type.Object({
	id: Type.Integer({ minimum: 1 }),
	path: Type.String(),
	head_sha: Type.String(),
	event: Type.String(),
	status: Type.String(),
	conclusion: Type.Union([Type.String(), Type.Null()]),
	run_number: Type.Integer({ minimum: 1 }),
	run_attempt: Type.Integer({ minimum: 1 }),
});
const JOB = Type.Object({
	name: Type.String(),
	status: Type.String(),
	conclusion: Type.Union([Type.String(), Type.Null()]),
});

// Undefined paths mean branch-only delivery; an empty PR diff requires full acceptance.
export function verifyDeliveryChecks(
	repository: string,
	sha: string,
	paths: readonly string[] | undefined,
	run: (command: readonly string[]) => string,
): string[] {
	const response: unknown = JSON.parse(
		run([
			"gh",
			"api",
			`repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`,
			"--paginate",
			"--slurp",
		]),
	);
	if (!Check(Type.Array(Type.Object({ workflow_runs: Type.Array(RUN) })), response))
		throw new Error(`Invalid CI workflow runs for ${sha}`);
	const event = paths === undefined ? "push" : "pull_request";
	const latest = response
		.flatMap((page) => page.workflow_runs)
		.filter(
			(item) =>
				item.path === ".github/workflows/ci.yml" &&
				item.head_sha === sha &&
				(item.event === event || item.event === "workflow_dispatch"),
		)
		.sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt || b.id - a.id)[0];
	if (!latest) throw new Error(`CI verification failed for ${sha}: no matching workflow run`);
	if (latest.status !== "completed" || latest.conclusion !== "success")
		throw new Error(`CI verification failed for ${sha}: latest workflow run is incomplete or unsuccessful`);
	const jobs: unknown = JSON.parse(
		run([
			"gh",
			"api",
			`repos/${repository}/actions/runs/${latest.id}/attempts/${latest.run_attempt}/jobs?per_page=100`,
			"--paginate",
			"--slurp",
		]),
	);
	if (!Check(Type.Array(Type.Object({ jobs: Type.Array(JOB) })), jobs))
		throw new Error(`Invalid CI jobs for run ${latest.id}`);
	const required = ["Fast"];
	if (latest.event === "workflow_dispatch" || (paths !== undefined && requiresFullAcceptance(paths)))
		required.push("Acceptance");
	const records = jobs.flatMap((page) => page.jobs);
	for (const name of required) {
		const matches = records.filter((job) => job.name === name);
		if (matches.length !== 1 || matches[0]?.status !== "completed" || matches[0].conclusion !== "success")
			throw new Error(`CI verification failed for ${sha}: ${name} is missing, incomplete, or unsuccessful`);
	}
	return [
		`[Actions run](https://github.com/${repository}/actions/runs/${latest.id}/attempts/${latest.run_attempt}): ${required.join(" and ")} passed for commit ${sha}.`,
	];
}
