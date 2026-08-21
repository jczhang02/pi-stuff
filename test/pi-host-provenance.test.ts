import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CERTIFIED_PI_HOST_PROFILE,
	CERTIFIED_PI_RELEASE_BINARY_SHA256,
	CERTIFIED_PI_SOURCE_COMMIT,
} from "../scripts/pi-host-contract.ts";
import { verifyPiHostProvenance } from "../scripts/verify-pi-host-provenance.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

test("the certified Host profile identifies one source commit and release binary", () => {
	expect(CERTIFIED_PI_HOST_PROFILE).toContain(`source.${CERTIFIED_PI_SOURCE_COMMIT.slice(0, 12)}`);
	expect(CERTIFIED_PI_HOST_PROFILE).toContain(`binary.${CERTIFIED_PI_RELEASE_BINARY_SHA256.slice(0, 12)}`);
});

test("Host provenance rejects an executable outside the release-binary allowlist", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-host-provenance-test-"));
	temporaryDirectories.push(directory);
	const binary = join(directory, "pi");
	await writeFile(binary, "compatible-looking fixture");

	await expect(verifyPiHostProvenance(binary)).rejects.toThrow("is not the certified");
});

test("Host provenance rejects symbolic links and non-regular files", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-host-provenance-test-"));
	temporaryDirectories.push(directory);
	const binary = join(directory, "pi");
	const link = join(directory, "pi-link");
	await writeFile(binary, "compatible-looking fixture");
	await symlink(binary, link);

	await expect(verifyPiHostProvenance(link)).rejects.toThrow("Cannot read PI_BIN");
	await expect(verifyPiHostProvenance("/dev/null")).rejects.toThrow("must be a regular file");
});
