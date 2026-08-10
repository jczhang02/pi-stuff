import { describe, expect, test } from "bun:test";
import {
	getPiSpawnCommand,
	PI_CODING_AGENT_PACKAGE,
} from "../../packages/pi-stuff/src/subagents/src/runs/shared/pi-spawn.ts";

describe("Pi child Host inheritance", () => {
	test("reuses the running standalone Pi executable instead of its package-resolved development Host", () => {
		const standaloneHost = "/opt/pi-coding-agent/pi";
		const oldPackageRoot = "/workspace/node_modules/@earendil-works/pi-coding-agent";
		const oldCli = `${oldPackageRoot}/dist/cli.js`;

		expect(
			getPiSpawnCommand(["--mode", "json", "-p"], {
				argv1: "/$bunfs/root/pi",
				execPath: standaloneHost,
				env: {},
				existsSync: (candidate) => candidate === standaloneHost || candidate === oldCli,
				realpathSync: (candidate) => candidate,
				resolvePackageJson: () => `${oldPackageRoot}/package.json`,
				readFileSync: () => JSON.stringify({ name: PI_CODING_AGENT_PACKAGE, bin: { pi: "dist/cli.js" } }),
			}),
		).toEqual({ command: standaloneHost, args: ["--mode", "json", "-p"] });
	});
});
