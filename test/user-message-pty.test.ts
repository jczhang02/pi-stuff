import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCase, TmuxPiSession } from "../scripts/ui-pty-session.js";
import { stageCertifiedPiHost } from "../scripts/verify-pi-host-provenance.js";

test("real Pi keeps a Skill and its prompt in one expandable User Message", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-user-message-"));
	let session: TmuxPiSession | undefined;
	try {
		const { PI_BIN = "/opt/bin/pi" } = process.env;
		const host = await stageCertifiedPiHost(PI_BIN, directory);
		const packagePath = resolve(import.meta.dir, "../packages/pi-stuff");
		const paths = await createCase(directory, "user-message", "dark", packagePath);
		session = new TmuxPiSession(paths, { piBinary: host.binaryPath, packagePath }, 100, 32);
		await session.start();
		await session.waitForStatusline();
		session.sendLiteral("/skill:humanizer-zh USER_MESSAGE_PTY_PROMPT");
		session.sendKey("Enter");
		const screen = await session.waitForText("USER_MESSAGE_PTY_PROMPT");
		expect(screen).toContain("  [skill] humanizer-zh USER_MESSAGE_PTY_PROMPT");
		expect(screen).not.toContain("to expand)");
		session.sendKey("C-o");
		const expanded = await session.waitForText("Skill instructions");
		expect(expanded.indexOf("USER_MESSAGE_PTY_PROMPT")).toBeLessThan(expanded.indexOf("Fixture instructions."));
		session.sendKey("C-o");
		expect(await session.waitForAbsence("Skill instructions")).toContain(
			"  [skill] humanizer-zh USER_MESSAGE_PTY_PROMPT",
		);
	} finally {
		session?.stop();
		await rm(directory, { recursive: true, force: true });
	}
}, 60_000);
