import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getArtifactsDir, getProjectArtifactsDir } from "../../packages/pi-stuff-agents/src/shared/artifacts.js";
import { DEFAULT_ARTIFACT_CONFIG, TEMP_ARTIFACTS_DIR } from "../../packages/pi-stuff-agents/src/shared/types.js";

describe("Agent artifact location", () => {
	test("defaults persisted sessions to their Settings-owned project session directory", () => {
		const sessionFile = "/settings/sessions/project-a/root.jsonl";
		const artifacts = getArtifactsDir(sessionFile, "/workspace/project-a");

		expect(DEFAULT_ARTIFACT_CONFIG.dir).toBe("session");
		expect(artifacts).toBe("/settings/sessions/project-a/subagent-artifacts");
		expect(artifacts).not.toStartWith("/workspace/project-a");
	});

	test("never falls back into the workspace when no persisted session exists", () => {
		expect(getArtifactsDir(null, "/workspace/project-a")).toBe(TEMP_ARTIFACTS_DIR);
	});

	test("keeps session artifacts isolated by Pi project session root", () => {
		const first = getArtifactsDir("/settings/sessions/project-a/root.jsonl", "/workspace/project");
		const second = getArtifactsDir("/settings/sessions/project-b/root.jsonl", "/workspace/project");

		expect(first).not.toBe(second);
		expect(first).toBe(join("/settings/sessions/project-a", "subagent-artifacts"));
		expect(second).toBe(join("/settings/sessions/project-b", "subagent-artifacts"));
	});

	test("preserves the explicit project policy as an opt-in", () => {
		expect(getArtifactsDir("/settings/sessions/project/root.jsonl", "/workspace/project", "project")).toBe(
			getProjectArtifactsDir("/workspace/project"),
		);
	});
});
