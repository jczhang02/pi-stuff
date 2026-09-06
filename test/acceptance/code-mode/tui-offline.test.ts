import { test } from "bun:test";
import { waitForDetachedProcess } from "../../../scripts/detached-process.ts";

test("Code Mode TUI acceptance uses the real Pi Host with an offline fixture Provider", async () => {
	const child = Bun.spawn([process.execPath, "scripts/verify-code-mode-tui.ts"], {
		detached: true,
		stderr: "inherit",
		stdout: "inherit",
	});
	const result = await waitForDetachedProcess(child, 180000);
	if (result.exitCode !== 0 || result.timedOut) throw new Error("Code Mode TUI acceptance failed");
}, 185000);
