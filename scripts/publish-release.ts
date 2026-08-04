import { readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
	createVerifiedReleaseSnapshot,
	RELEASE_MANIFEST_FILENAME,
	RELEASE_PACKAGES,
	readVerifiedRelease,
} from "./release-artifacts.ts";
import { CERTIFIED_PI_HOST_PROFILE } from "./verify-package.ts";

function fail(message: string): never {
	throw new Error(`Release publication refused: ${message}`);
}

function publishedIntegrity(name: string, version: string): string | undefined {
	const result = Bun.spawnSync([process.execPath, "pm", "view", `${name}@${version}`, "dist.integrity", "--json"], {
		stderr: "pipe",
		stdout: "pipe",
	});
	const stdout = result.stdout.toString().trim();
	const stderr = result.stderr.toString().trim();
	if (result.exitCode !== 0) {
		const detail = `${stderr}\n${stdout}`;
		if (/\b404\b|not found|no version|does not exist/i.test(detail)) return undefined;
		fail(`could not inspect ${name}@${version}: ${stderr || stdout || `exit ${result.exitCode}`}`);
	}
	let value: unknown;
	try {
		value = JSON.parse(stdout);
	} catch {
		fail(`registry returned invalid integrity metadata for ${name}@${version}`);
	}
	if (typeof value !== "string" || !value.startsWith("sha512-")) {
		fail(`registry has ${name}@${version} without comparable integrity metadata`);
	}
	return value;
}

function parseArguments(): { manifestPath: string; tag: string } {
	const arguments_ = process.argv.slice(2);
	if (!arguments_.includes("--confirm-publish")) fail("pass --confirm-publish for an intentional registry write");
	let manifestPath = resolve(import.meta.dir, "../.artifacts/release/release-manifest.json");
	let tag = "latest";
	for (let index = 0; index < arguments_.length; index++) {
		const argument = arguments_[index];
		if (argument === "--confirm-publish") continue;
		if (argument !== "--manifest" && argument !== "--tag") fail(`unknown argument ${argument}`);
		const value = arguments_[index + 1];
		if (!value) fail(`${argument} requires a value`);
		if (argument === "--manifest") manifestPath = resolve(value);
		else tag = value;
		index += 1;
	}
	if (!/^[a-z0-9][a-z0-9._-]*$/i.test(tag)) fail(`invalid npm tag ${tag}`);
	return { manifestPath, tag };
}

const { manifestPath, tag } = parseArguments();
if (basename(manifestPath) !== RELEASE_MANIFEST_FILENAME) fail(`manifest must be named ${RELEASE_MANIFEST_FILENAME}`);
const destination = dirname(manifestPath);
const manifest = await readVerifiedRelease(destination, CERTIFIED_PI_HOST_PROFILE);
const snapshot = await createVerifiedReleaseSnapshot(destination, manifest);

try {
	for (const [index, artifact] of manifest.artifacts.entries()) {
		const releasePackage = RELEASE_PACKAGES[index];
		if (!releasePackage || releasePackage.name !== artifact.name) {
			fail(`artifact ${artifact.name} has no matching workspace Package`);
		}
		const workspaceManifest = JSON.parse(
			await readFile(join(resolve(import.meta.dir, ".."), releasePackage.path, "package.json"), "utf8"),
		) as { name?: unknown; version?: unknown };
		if (workspaceManifest.name !== artifact.name || workspaceManifest.version !== artifact.version) {
			fail(`${artifact.name}@${artifact.version} no longer matches the workspace`);
		}
		const existingIntegrity = publishedIntegrity(artifact.name, artifact.version);
		if (existingIntegrity !== undefined) {
			if (existingIntegrity !== artifact.integrity) {
				fail(`${artifact.name}@${artifact.version} already exists with different bytes`);
			}
			console.log(`Already published and byte-identical: ${artifact.name}@${artifact.version}`);
			continue;
		}
		const archivePath = snapshot.archivePaths[index];
		if (!archivePath) fail(`artifact ${artifact.name} has no verified publication snapshot`);
		const result = Bun.spawnSync(
			[process.execPath, "publish", "--ignore-scripts", "--access", "public", "--tag", tag, archivePath],
			{
				cwd: snapshot.directory,
				stderr: "inherit",
				stdout: "inherit",
			},
		);
		if (result.exitCode !== 0) fail(`Bun rejected ${artifact.name}@${artifact.version}`);
	}
} finally {
	await rm(snapshot.directory, { recursive: true, force: true });
}
