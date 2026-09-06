import { describe, expect, test } from "bun:test";
import { verifyCiResult } from "../scripts/verify-ci-result.ts";

const passed = {
	CI_PLAN_RESULT: "success",
	CI_CHECKS_RESULT: "success",
	CI_TESTS_REQUIRED: "true",
	CI_TESTS_RESULT: "success",
};

describe("CI result", () => {
	test("accepts complete tests or the successful plan's explicit no-tests decision", () => {
		expect(() => verifyCiResult(passed)).not.toThrow();
		expect(() => verifyCiResult({ ...passed, CI_TESTS_REQUIRED: "false", CI_TESTS_RESULT: "skipped" })).not.toThrow();
	});

	test("rejects missing, failed, cancelled and skipped required jobs", () => {
		for (const key of ["CI_PLAN_RESULT", "CI_CHECKS_RESULT", "CI_TESTS_RESULT"]) {
			for (const value of ["", "failure", "cancelled", "skipped"]) {
				expect(() => verifyCiResult({ ...passed, [key]: value })).toThrow();
			}
		}
		expect(() => verifyCiResult({})).toThrow();
	});

	test("rejects absent or malformed plan decisions and unexpected test outcomes", () => {
		for (const value of ["", "TRUE", "1"]) {
			expect(() => verifyCiResult({ ...passed, CI_TESTS_REQUIRED: value })).toThrow();
		}
		for (const result of ["success", "failure", "cancelled", ""]) {
			expect(() => verifyCiResult({ ...passed, CI_TESTS_REQUIRED: "false", CI_TESTS_RESULT: result })).toThrow();
		}
	});
});
