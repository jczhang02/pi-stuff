import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeModeHostClient } from "../../packages/pi-stuff/src/code-mode/host/host-client.js";

async function hangingHost(): Promise<{ readonly directory: string; readonly path: string }> {
	const directory = await mkdtemp(join(tmpdir(), "pi-stuff-code-mode-host-client-"));
	const path = join(directory, "host");
	await writeFile(path, "#!/bin/sh\nsleep 30\n");
	await chmod(path, 0o755);
	return { directory, path };
}

test("a host that never handshakes is bounded and torn down", async () => {
	const fixture = await hangingHost();
	const client = new CodeModeHostClient(fixture.path, 30);
	try {
		await expect(client.start()).rejects.toThrow("startup timed out after 30 ms");
	} finally {
		await client.shutdown();
		await rm(fixture.directory, { force: true, recursive: true });
	}
});

test("host startup follows the outer Tool cancellation signal", async () => {
	const fixture = await hangingHost();
	const client = new CodeModeHostClient(fixture.path, 5_000);
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 20);
	try {
		await expect(client.start(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
	} finally {
		await client.shutdown();
		await rm(fixture.directory, { force: true, recursive: true });
	}
});
