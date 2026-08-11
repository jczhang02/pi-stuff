import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	access,
	cp,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	readlink,
	realpath,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readProcessStartIdentity } from "../packages/pi-stuff/src/code-mode/host/process-start-identity.js";

const EMBEDDED_ATTESTATION = "pi-host-attestation.json";
const FACADE_BINARY_TARGET = "../current/linux-x64/pi";
const FACADE_ATTESTATION_TARGET = "pi-host/current/pi-host-attestation.json";
const PUBLISH_LOCK_ARTIFACT_STALE_MS = 10 * 60_000;

interface PublishPiHostOptions {
	readonly attestationPath: string;
	readonly generationsDirectory: string;
	readonly hostDirectory: string;
	readonly stagedHostDirectory: string;
	readonly verify: () => Promise<void> | void;
}

interface PublishLock {
	readonly directory: string;
	readonly token: string;
}

export interface PreparedPiHostGeneration {
	readonly currentPath: string;
	readonly generationDirectory: string;
	readonly generationTarget: string;
	readonly lock: PublishLock;
}

interface LockOwner {
	readonly bootId: string;
	readonly pid: number;
	readonly startTime: string;
	readonly token: string;
}

function parseLockOwner(value: unknown): LockOwner | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const bootId = Reflect.get(value, "bootId");
	const pid = Reflect.get(value, "pid");
	const startTime = Reflect.get(value, "startTime");
	const token = Reflect.get(value, "token");
	if (
		typeof bootId !== "string" ||
		!Number.isSafeInteger(pid) ||
		(pid as number) <= 0 ||
		typeof startTime !== "string" ||
		typeof token !== "string" ||
		token.length === 0
	) {
		return undefined;
	}
	return { bootId, pid: pid as number, startTime, token };
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function syncPath(path: string): Promise<void> {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function syncTree(directory: string): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await syncTree(path);
		else if (entry.isFile()) await syncPath(path);
	}
	await syncPath(directory);
}

async function sha256File(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

async function assertSameBytes(first: string, second: string, description: string): Promise<void> {
	const [firstHash, secondHash] = await Promise.all([sha256File(first), sha256File(second)]);
	if (firstHash !== secondHash) throw new Error(`${description} changed during crash-safe facade migration`);
}

function isErrno(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

async function currentBootId(): Promise<string> {
	try {
		return (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
	} catch {
		return "unavailable";
	}
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

async function lockOwnerIsActive(owner: LockOwner, bootId: string): Promise<boolean> {
	if (owner.bootId !== bootId || !processExists(owner.pid)) return false;
	const currentStartTime = readProcessStartIdentity(owner.pid);
	return (
		currentStartTime === undefined ||
		currentStartTime === owner.startTime ||
		currentStartTime === `${owner.bootId}:${owner.startTime}`
	);
}

async function cleanupAbandonedPublishLockArtifacts(directory: string, bootId: string): Promise<void> {
	const parent = dirname(directory);
	const prefix = `${basename(directory)}.`;
	for (const entry of await readdir(parent, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
		const path = join(parent, entry.name);
		const metadata = await lstat(path).catch((error: unknown) => {
			if (isErrno(error, "ENOENT")) return undefined;
			throw error;
		});
		if (!metadata || Date.now() - metadata.mtimeMs <= PUBLISH_LOCK_ARTIFACT_STALE_MS) continue;
		let owner: LockOwner | undefined;
		try {
			owner = parseLockOwner(JSON.parse(await readFile(join(path, "owner.json"), "utf8")));
		} catch {
			// An old incomplete artifact has no active owner to preserve.
		}
		if (owner && (await lockOwnerIsActive(owner, bootId))) continue;
		await rm(path, { force: true, recursive: true });
	}
}

async function acquirePublishLock(artifactsDirectory: string): Promise<PublishLock> {
	const directory = join(artifactsDirectory, ".pi-host-publish.lock");
	const bootId = await currentBootId();
	const startTime = readProcessStartIdentity(process.pid);
	if (!startTime) throw new Error("Cannot identify the Pi Host publisher process start time");
	await cleanupAbandonedPublishLockArtifacts(directory, bootId);
	for (;;) {
		const token = randomUUID();
		const candidate = `${directory}.candidate-${token}`;
		const owner: LockOwner = { bootId, pid: process.pid, startTime, token };
		await mkdir(candidate);
		await writeFile(join(candidate, "owner.json"), `${JSON.stringify(owner)}\n`, { mode: 0o600 });
		await syncTree(candidate);
		try {
			await rename(candidate, directory);
			await syncPath(artifactsDirectory);
			return { directory, token };
		} catch (error) {
			await rm(candidate, { force: true, recursive: true });
			if (!isErrno(error, "EEXIST") && !isErrno(error, "ENOTEMPTY")) throw error;
		}

		let existing: LockOwner | undefined;
		try {
			existing = parseLockOwner(JSON.parse(await readFile(join(directory, "owner.json"), "utf8")));
		} catch {
			// An invalid owner is identified by the locked directory inode below.
		}
		if (existing && (await lockOwnerIsActive(existing, bootId))) {
			throw new Error(`Another Pi Host publication is active in process ${String(existing.pid)}`);
		}
		const metadata = await lstat(directory).catch((error: unknown) => {
			if (isErrno(error, "ENOENT")) return undefined;
			throw error;
		});
		if (!metadata) continue;
		const staleIdentity = existing?.token ?? `${String(metadata.dev)}:${String(metadata.ino)}`;
		const reclaimKey = createHash("sha256").update(staleIdentity).digest("hex").slice(0, 20);
		const reclaim = `${directory}.reclaim-${reclaimKey}`;
		const reclaimToken = randomUUID();
		const reclaimCandidate = `${reclaim}.candidate-${reclaimToken}`;
		const reclaimOwner: LockOwner = { bootId, pid: process.pid, startTime, token: reclaimToken };
		try {
			await mkdir(reclaimCandidate);
			await writeFile(join(reclaimCandidate, "owner.json"), `${JSON.stringify(reclaimOwner)}\n`, { mode: 0o600 });
			await syncTree(reclaimCandidate);
			await rename(reclaimCandidate, reclaim);
		} catch (error) {
			await rm(reclaimCandidate, { force: true, recursive: true });
			if (!isErrno(error, "EEXIST") && !isErrno(error, "ENOTEMPTY")) throw error;
			await delay(25);
			continue;
		}
		try {
			const currentMetadata = await lstat(directory).catch((error: unknown) => {
				if (isErrno(error, "ENOENT")) return undefined;
				throw error;
			});
			if (!currentMetadata) continue;
			let currentOwner: LockOwner | undefined;
			try {
				currentOwner = parseLockOwner(JSON.parse(await readFile(join(directory, "owner.json"), "utf8")));
			} catch {
				// The inode remains the identity for a malformed owner.
			}
			const currentIdentity = currentOwner?.token ?? `${String(currentMetadata.dev)}:${String(currentMetadata.ino)}`;
			if (currentIdentity !== staleIdentity) continue;
			if (currentOwner && (await lockOwnerIsActive(currentOwner, bootId))) {
				throw new Error(`Another Pi Host publication is active in process ${String(currentOwner.pid)}`);
			}
			const stale = `${directory}.stale-${randomUUID()}`;
			try {
				await rename(directory, stale);
			} catch (error) {
				if (isErrno(error, "ENOENT")) continue;
				throw error;
			}
			await syncPath(artifactsDirectory);
			await rm(stale, { force: true, recursive: true });
		} finally {
			await rm(reclaim, { force: true, recursive: true });
		}
	}
}

async function releasePublishLock(lock: PublishLock): Promise<void> {
	let owner: LockOwner;
	try {
		owner = JSON.parse(await readFile(join(lock.directory, "owner.json"), "utf8")) as LockOwner;
	} catch (error) {
		if (isErrno(error, "ENOENT")) return;
		throw error;
	}
	if (owner.token !== lock.token) throw new Error("Pi Host publish lock ownership changed unexpectedly");
	const released = `${lock.directory}.released-${lock.token}`;
	await rename(lock.directory, released);
	await syncPath(dirname(lock.directory));
	await rm(released, { force: true, recursive: true });
}

async function atomicRelativeSymlink(target: string, destination: string): Promise<void> {
	const parent = dirname(destination);
	const temporary = join(parent, `.${basename(destination)}.next-${randomUUID()}`);
	await symlink(target, temporary);
	await syncPath(parent);
	await rename(temporary, destination);
	await syncPath(parent);
}

function isWithin(root: string, path: string): boolean {
	return path === root || path.startsWith(`${root}${sep}`);
}

async function pinnedCurrentGeneration(
	hostDirectory: string,
	generationsDirectory: string,
): Promise<string | undefined> {
	const currentPath = join(hostDirectory, "current");
	let metadata: Awaited<ReturnType<typeof lstat>>;
	try {
		metadata = await lstat(currentPath);
	} catch (error) {
		if (isErrno(error, "ENOENT")) return undefined;
		throw error;
	}
	if (!metadata.isSymbolicLink()) throw new Error("Pi Host current pointer must be a symbolic link");
	const target = await readlink(currentPath);
	if (resolve(target) === target) throw new Error("Pi Host current pointer must use a relative generation target");
	const [generation, generationsRoot] = await Promise.all([
		realpath(resolve(hostDirectory, target)),
		realpath(generationsDirectory),
	]);
	if (!isWithin(generationsRoot, generation)) throw new Error("Pi Host current pointer escapes immutable generations");
	return generation;
}

async function ensureFacadeLink(
	destination: string,
	expectedTarget: string,
	generationFile: string,
	allowMissing: boolean,
): Promise<void> {
	let metadata: Awaited<ReturnType<typeof lstat>>;
	try {
		metadata = await lstat(destination);
	} catch (error) {
		if (!isErrno(error, "ENOENT")) throw error;
		if (!allowMissing) throw new Error(`Missing existing Pi Host facade path: ${destination}`);
		await atomicRelativeSymlink(expectedTarget, destination);
		return;
	}
	if (metadata.isSymbolicLink()) {
		if ((await readlink(destination)) !== expectedTarget) {
			throw new Error(`Refusing unexpected Pi Host facade link: ${destination}`);
		}
		if (allowMissing) return;
		if ((await realpath(destination)) !== (await realpath(generationFile))) {
			throw new Error(`Pi Host facade does not resolve through current: ${destination}`);
		}
		return;
	}
	if (!metadata.isFile()) throw new Error(`Refusing non-file Pi Host facade path: ${destination}`);
	await assertSameBytes(destination, generationFile, "Pi Host facade file");
	await atomicRelativeSymlink(expectedTarget, destination);
}

async function publishImmutableGeneration(
	stagedHostDirectory: string,
	generationsDirectory: string,
	prefix: string,
): Promise<string> {
	await syncTree(stagedHostDirectory);
	await mkdir(generationsDirectory, { recursive: true });
	await syncPath(dirname(generationsDirectory));
	const generation = join(generationsDirectory, `${prefix}-${randomUUID()}`);
	await rename(stagedHostDirectory, generation);
	await syncPath(generationsDirectory);
	return generation;
}

async function migrateFacade(options: PublishPiHostOptions, newGeneration: string): Promise<void> {
	const facadeBinary = join(options.hostDirectory, "linux-x64", "pi");
	const currentPath = join(options.hostDirectory, "current");
	await mkdir(join(options.hostDirectory, "linux-x64"), { recursive: true });
	let currentGeneration = await pinnedCurrentGeneration(options.hostDirectory, options.generationsDirectory);
	if (!currentGeneration) {
		const hasBinary = await exists(facadeBinary);
		const hasAttestation = await exists(options.attestationPath);
		if (hasBinary !== hasAttestation) {
			throw new Error("Cannot migrate an incomplete legacy Pi Host/record pair");
		}
		if (hasBinary) {
			const binaryHashBefore = await sha256File(facadeBinary);
			const attestationHashBefore = await sha256File(options.attestationPath);
			const legacyStaging = join(options.generationsDirectory, `.legacy-${randomUUID()}`);
			await cp(options.hostDirectory, legacyStaging, { recursive: true, verbatimSymlinks: true });
			await cp(options.attestationPath, join(legacyStaging, EMBEDDED_ATTESTATION));
			currentGeneration = await publishImmutableGeneration(legacyStaging, options.generationsDirectory, "legacy");
			if (
				(await sha256File(join(currentGeneration, "linux-x64", "pi"))) !== binaryHashBefore ||
				(await sha256File(join(currentGeneration, EMBEDDED_ATTESTATION))) !== attestationHashBefore
			) {
				throw new Error("Legacy Pi Host pair changed while creating its immutable generation");
			}
			await atomicRelativeSymlink(relative(options.hostDirectory, currentGeneration), currentPath);
			await ensureFacadeLink(
				options.attestationPath,
				FACADE_ATTESTATION_TARGET,
				join(currentGeneration, EMBEDDED_ATTESTATION),
				false,
			);
			await ensureFacadeLink(facadeBinary, FACADE_BINARY_TARGET, join(currentGeneration, "linux-x64", "pi"), false);
			if (
				(await sha256File(facadeBinary)) !== binaryHashBefore ||
				(await sha256File(options.attestationPath)) !== attestationHashBefore
			) {
				throw new Error("Legacy Pi Host facade changed bytes during migration");
			}
			return;
		}

		await ensureFacadeLink(
			options.attestationPath,
			FACADE_ATTESTATION_TARGET,
			join(newGeneration, EMBEDDED_ATTESTATION),
			true,
		);
		await ensureFacadeLink(facadeBinary, FACADE_BINARY_TARGET, join(newGeneration, "linux-x64", "pi"), true);
		return;
	}

	await ensureFacadeLink(
		options.attestationPath,
		FACADE_ATTESTATION_TARGET,
		join(currentGeneration, EMBEDDED_ATTESTATION),
		false,
	);
	await ensureFacadeLink(facadeBinary, FACADE_BINARY_TARGET, join(currentGeneration, "linux-x64", "pi"), false);
}

/** Durably publishes an immutable generation while the single current pointer still exposes the last-good pair. */
export async function prepareVerifiedPiHostGeneration(
	options: PublishPiHostOptions,
): Promise<PreparedPiHostGeneration> {
	const artifactsDirectory = dirname(options.hostDirectory);
	const lock = await acquirePublishLock(artifactsDirectory);
	try {
		await options.verify();
		if (!(await exists(join(options.stagedHostDirectory, "linux-x64", "pi")))) {
			throw new Error("Staged Pi Host generation has no Linux x64 binary");
		}
		if (!(await exists(join(options.stagedHostDirectory, EMBEDDED_ATTESTATION)))) {
			throw new Error("Staged Pi Host generation has no embedded build record");
		}
		const generationDirectory = await publishImmutableGeneration(
			options.stagedHostDirectory,
			options.generationsDirectory,
			"generation",
		);
		await migrateFacade(options, generationDirectory);
		return {
			currentPath: join(options.hostDirectory, "current"),
			generationDirectory,
			generationTarget: relative(options.hostDirectory, generationDirectory),
			lock,
		};
	} catch (error) {
		await releasePublishLock(lock);
		throw error;
	}
}

/** The only commit point: one same-directory symlink rename switches binary and record together. */
export async function activatePreparedPiHostGeneration(prepared: PreparedPiHostGeneration): Promise<void> {
	try {
		await atomicRelativeSymlink(prepared.generationTarget, prepared.currentPath);
	} finally {
		await releasePublishLock(prepared.lock);
	}
}

export async function publishVerifiedPiHost(options: PublishPiHostOptions): Promise<void> {
	const prepared = await prepareVerifiedPiHostGeneration(options);
	await activatePreparedPiHostGeneration(prepared);
}
