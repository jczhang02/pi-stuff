import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildVerificationPlan } from "./verification-plan.ts";

function main(): void {
	if (process.argv.includes("--help")) {
		console.log("Usage: bun run verify [--base <ref>] [--output <report.json>] [--list]");
		return;
	}
	const baseIndex = process.argv.indexOf("--base");
	const outputIndex = process.argv.indexOf("--output");
	const env = { ...process.env, ...(baseIndex >= 0 ? { VERIFY_BASE: process.argv[baseIndex + 1] } : {}) };
	const plan = buildVerificationPlan(process.cwd(), env);
	if (process.argv.includes("--list")) {
		console.log(plan.files.join("\n") || `No tests selected: ${plan.reason}`);
		return;
	}
	const output = (outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined) ?? ".artifacts/verify.json";
	mkdirSync(dirname(resolve(output)), { recursive: true });
	const check = spawnSync("bun", ["run", "check"], { stdio: "inherit", env });
	if (check.status !== 0) {
		Bun.write(output, `${JSON.stringify({ status: "failed", checks: "failed", tests: "not-run", plan }, null, 2)}\n`);
		process.exitCode = check.status ?? 1;
		return;
	}
	Bun.write(output, `${JSON.stringify({ status: "planned", checks: "passed", plan }, null, 2)}\n`);
	const planPath = ".artifacts/verification-plan.json";
	mkdirSync(dirname(resolve(planPath)), { recursive: true });
	Bun.write(planPath, `${JSON.stringify(plan, null, 2)}\n`);
	const tests = spawnSync("bun", ["run", "test", "--plan", planPath], { stdio: "inherit", env });
	if (tests.status !== 0) process.exitCode = tests.status ?? 1;
}
if (import.meta.main) main();
