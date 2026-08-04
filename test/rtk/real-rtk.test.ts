import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	CERTIFIED_RTK_LINUX_X64_SHA256,
	CERTIFIED_RTK_VERSION,
	RtkRuntime,
} from "../../packages/pi-stuff-rtk/runtime.js";

const localRtk = process.env["RTK_BIN"]?.trim() || Bun.which("rtk") || "";

async function execute(command: string, args: string[], options: { timeout?: number } = {}) {
	if (command === "which") {
		return { code: localRtk ? 0 : 1, killed: false, stderr: "", stdout: localRtk ? `${localRtk}\n` : "" };
	}
	const child = Bun.spawn([command, ...args], { stderr: "pipe", stdout: "pipe" });
	let killed = false;
	const timer = setTimeout(() => {
		killed = true;
		child.kill(9);
	}, options.timeout ?? 2_500);
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	clearTimeout(timer);
	return { code, killed, stderr, stdout };
}

test.skipIf(!localRtk)("certifies and uses the real local RTK 0.42.4 executable", async () => {
	const pi = { exec: execute } as Pick<ExtensionAPI, "exec">;
	const runtime = new RtkRuntime();

	expect(await runtime.rewrite(pi, "git status")).toBe("rtk git status");
	expect(runtime.snapshot()).toMatchObject({
		path: localRtk,
		sha256: CERTIFIED_RTK_LINUX_X64_SHA256,
		state: "ready",
		version: CERTIFIED_RTK_VERSION,
	});
});
