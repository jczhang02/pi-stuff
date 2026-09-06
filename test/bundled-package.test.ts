import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseJsonValue } from "../packages/pi-stuff/src/shared/json-value.js";
import {
	type PackageManifest,
	verifyInstalledRuntimeDependencies,
	verifyPackageManifest,
	verifyPackageSource,
} from "../scripts/verify-package.ts";

const packageDirectory = resolve(import.meta.dir, "../packages/pi-stuff");

async function packageManifest(): Promise<PackageManifest> {
	// SAFETY: this repository-controlled fixture is validated by the source Package test before mutation cases.
	return parseJsonValue(await readFile(resolve(packageDirectory, "package.json"), "utf8")) as PackageManifest;
}

test("the source Package satisfies its manifest and resource constraints", async () => {
	await verifyPackageSource(packageDirectory);
});

test("every exact runtime dependency is installed at its declared identity", async () => {
	await verifyInstalledRuntimeDependencies(packageDirectory);
});

test("Package manifest rejects publication and nested Package boundaries", async () => {
	const manifest = await packageManifest();
	expect(() => verifyPackageManifest({ ...manifest, private: false })).toThrow("must remain a private local Package");
	expect(() => verifyPackageManifest({ ...manifest, bundledDependencies: ["typebox"] })).toThrow(
		"must not use bundledDependencies",
	);
	expect(() => verifyPackageManifest({ ...manifest, dependencies: { "@jczhang02/pi-stuff": "1.0.0" } })).toThrow(
		"only external runtime dependencies",
	);
});
