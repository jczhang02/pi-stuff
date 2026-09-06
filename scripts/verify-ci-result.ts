import assert from "node:assert/strict";

export function verifyCiResult(environment: NodeJS.ProcessEnv): void {
	assert.equal(environment["CI_PLAN_RESULT"], "success", "Plan must pass");
	assert.equal(environment["CI_CHECKS_RESULT"], "success", "Checks must pass");
	const required = environment["CI_TESTS_REQUIRED"];
	assert(required === "true" || required === "false", "Plan must explicitly select Tests");
	assert.equal(
		environment["CI_TESTS_RESULT"],
		required === "true" ? "success" : "skipped",
		"Tests must match the successful Plan decision",
	);
}

if (import.meta.main) verifyCiResult(process.env);
