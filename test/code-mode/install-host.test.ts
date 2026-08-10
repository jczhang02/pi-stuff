import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCodeModeHost } from "../../packages/pi-stuff/src/code-mode/host/install-host.js";

test("host installation releases its lock when temporary staging cannot start", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-stuff-code-mode-installer-"));
	const invalidTemporaryRoot = join(directory, "not-a-directory");
	const destination = join(directory, "cache", "codex-code-mode-host");
	await writeFile(invalidTemporaryRoot, "fixture");
	try {
		await expect(
			installCodeModeHost({
				arch: "x64",
				destination,
				platform: "linux",
				temporaryDirectory: invalidTemporaryRoot,
			}),
		).rejects.toThrow();
		expect(await Bun.file(`${destination}.lock`).exists()).toBe(false);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
