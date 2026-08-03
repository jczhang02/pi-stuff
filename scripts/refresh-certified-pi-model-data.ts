import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { certifiedPiSourceDirectory, prepareSource, runVisible, verifyToolchain } from "./build-certified-pi-host.ts";
import { CERTIFIED_PI_MODEL_DATA_SHA256 } from "./pi-host-contract.ts";
import { writeContentAddressedModelDataSnapshot } from "./pi-host-model-data.ts";

const root = resolve(import.meta.dir, "..");
const snapshotsRoot = join(root, "vendor", "pi-host-model-data");
const modelDataDirectory = join(certifiedPiSourceDirectory, "packages", "ai", "src", "providers", "data");

await verifyToolchain();
await mkdir(join(root, ".artifacts"), { recursive: true });
await prepareSource();
await runVisible(["npm", "ci", "--ignore-scripts"], certifiedPiSourceDirectory);
await runVisible(["npm", "run", "hydrate:model-data"], certifiedPiSourceDirectory);
await runVisible(["npm", "run", "check:model-data"], certifiedPiSourceDirectory);

const snapshot = await writeContentAddressedModelDataSnapshot(modelDataDirectory, snapshotsRoot);
const digest = basename(snapshot);
console.log(`Wrote reviewed Pi model-data candidate: ${snapshot}`);
if (digest === CERTIFIED_PI_MODEL_DATA_SHA256) {
	console.log("The live catalog normalizes to the already-certified snapshot; no profile change is required.");
} else {
	console.log(`Review the snapshot diff, then explicitly set CERTIFIED_PI_MODEL_DATA_SHA256 to ${digest}.`);
}
