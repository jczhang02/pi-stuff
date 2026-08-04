import { test } from "bun:test";
import { resolve } from "node:path";
import { verifyContextPty } from "../scripts/verify-context-pty.ts";

const { PI_BIN = "/opt/pi-coding-agent/pi" } = process.env;

test("real Pi TUI activates Magic Context, resumes it, owns compaction, and fails open", async () => {
	await verifyContextPty({
		piBinary: PI_BIN,
		packagePath: resolve(import.meta.dir, "../packages/pi-stuff"),
	});
}, 120_000);
