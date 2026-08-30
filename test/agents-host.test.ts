import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { buildPiArgs, PI_STUFF_AGENT_PATH_ENV } from "../packages/pi-stuff/src/subagents/src/runs/shared/pi-args.ts";
import { CERTIFIED_PI_VERSION } from "../scripts/pi-host-contract.ts";
import { runPiRpcSmoke } from "../scripts/smoke-pi.ts";

const { PI_BIN: PI_BINARY = "/opt/pi-coding-agent/pi" } = process.env;
const PI_STUFF_PACKAGE = resolve(import.meta.dir, "../packages/pi-stuff");
const PACKAGE_MANIFEST_SCHEMA = Type.Object(
	{
		dependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
		peerDependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
		private: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: true },
);
const DEVELOPMENT_MANIFEST_SCHEMA = Type.Object(
	{
		devDependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
		workspaces: Type.Optional(Type.Array(Type.String())),
	},
	{ additionalProperties: true },
);

test("Agents gives same-name sibling processes stable unique path components", () => {
	const previousAgentPath = process.env[PI_STUFF_AGENT_PATH_ENV];
	process.env[PI_STUFF_AGENT_PATH_ENV] = "root-run:0";
	const buildChildPath = (runId?: string, childIndex?: number): string | undefined => {
		const options: Parameters<typeof buildPiArgs>[0] = {
			baseArgs: [],
			task: "path identity test",
			sessionEnabled: false,
			inheritProjectContext: true,
			inheritSkills: true,
			childAgentName: "general",
		};
		if (runId) options.runId = runId;
		if (childIndex !== undefined) options.childIndex = childIndex;
		return buildPiArgs(options).env[PI_STUFF_AGENT_PATH_ENV];
	};

	try {
		expect(buildChildPath("parallel-run", 1)).toBe("root-run:0 › parallel-run:1");
		expect(buildChildPath("parallel-run", 2)).toBe("root-run:0 › parallel-run:2");
		expect(buildChildPath()).toBe("root-run:0");
	} finally {
		if (previousAgentPath === undefined) delete process.env[PI_STUFF_AGENT_PATH_ENV];
		else process.env[PI_STUFF_AGENT_PATH_ENV] = previousAgentPath;
	}
});

test("Subagents shares one local Package and the certified Pi peer contract", async () => {
	const packageManifest = JSON.parse(await readFile(resolve(PI_STUFF_PACKAGE, "package.json"), "utf8"));
	if (!Check(PACKAGE_MANIFEST_SCHEMA, packageManifest)) throw new Error("Expected the Pi Stuff package manifest");
	const developmentManifest = JSON.parse(await readFile(resolve(PI_STUFF_PACKAGE, "../../package.json"), "utf8"));
	if (!Check(DEVELOPMENT_MANIFEST_SCHEMA, developmentManifest)) throw new Error("Expected the workspace manifest");

	expect(packageManifest.private).toBe(true);
	expect(Object.keys(packageManifest.dependencies ?? {}).filter((name) => name.startsWith("@jczhang02/pi-"))).toEqual(
		[],
	);
	expect(packageManifest.peerDependencies).toEqual({
		"@earendil-works/pi-agent-core": "*",
		"@earendil-works/pi-ai": "*",
		"@earendil-works/pi-coding-agent": "*",
		"@earendil-works/pi-tui": "*",
	});
	expect(developmentManifest.workspaces).toEqual(["packages/pi-stuff"]);
	for (const dependency of Object.keys(packageManifest.peerDependencies ?? {})) {
		expect(developmentManifest.devDependencies?.[dependency]).toBe(CERTIFIED_PI_VERSION);
	}
});

test("the certified Pi Host loads Agents through the single Pi Stuff Package", async () => {
	const result = await runPiRpcSmoke({ piBinary: PI_BINARY, packages: [PI_STUFF_PACKAGE] });
	expect(result.commandNames).toContain("agents");
	expect(result.stderr).toBe("");
}, 30_000);
