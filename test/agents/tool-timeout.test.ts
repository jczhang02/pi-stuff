import { expect, test } from "bun:test";
import {
	DEFAULT_FAST_TOOL_TIMEOUT_MS,
	effectiveToolTimeoutMs,
	resolveToolTimeoutMs,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/tool-timeout.js";

test("resolves Tool timeouts by precedence with safe defaults and waiting-tool exemptions", () => {
	expect(resolveToolTimeoutMs({ callValue: 10, agentValue: 20, envValue: "30" })).toEqual({ toolTimeoutMs: 10 });
	expect(resolveToolTimeoutMs({ agentValue: 20, envValue: "30" })).toEqual({ toolTimeoutMs: 20 });
	expect(resolveToolTimeoutMs({ envValue: "30" })).toEqual({ toolTimeoutMs: 30 });
	expect(resolveToolTimeoutMs({ envValue: "0" }).error).toContain("positive integer");
	expect(effectiveToolTimeoutMs("read", undefined)).toBe(DEFAULT_FAST_TOOL_TIMEOUT_MS);
	expect(effectiveToolTimeoutMs("bash", undefined)).toBeUndefined();
	expect(effectiveToolTimeoutMs("contact_supervisor", 10)).toBeUndefined();
});
