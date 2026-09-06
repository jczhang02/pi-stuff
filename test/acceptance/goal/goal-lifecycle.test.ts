import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyGoalLifecycle } from "../../../scripts/verify-goal-lifecycle.ts";

test(
	"Goal lifecycle through the complete Suite",
	() =>
		verifyGoalLifecycle({
			piBinary: process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi",
			packagePath: resolve(import.meta.dirname, "../../../packages/pi-stuff"),
		}),
	120_000,
);
