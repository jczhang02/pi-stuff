import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getProxyForUrl } from "proxy-from-env";
import { codeModeHostBinaryName, hostAssetUrl, resolveCodeModeHostAsset } from "./host-assets.js";

const DOWNLOAD_TIMEOUT_MS = 120_000;
const INSTALL_LOCK_POLL_MS = 200;
const INSTALL_LOCK_TIMEOUT_MS = 125_000;
const INSTALL_LOCK_STALE_MS = 180_000;

export interface InstallCodeModeHostOptions {
	readonly arch: string;
	readonly destination: string;
	readonly platform: string;
	readonly signal?: AbortSignal;
	/** Override the staging root; defaults to the operating-system temporary directory. */
	readonly temporaryDirectory?: string;
}

function walk(directory: string): string[] {
	const output: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) output.push(...walk(path));
		else output.push(path);
	}
	return output;
}

async function acquireInstallLock(
	lockPath: string,
	destination: string,
	signal: AbortSignal | undefined,
): Promise<boolean> {
	const deadline = Date.now() + INSTALL_LOCK_TIMEOUT_MS;
	while (Date.now() < deadline) {
		signal?.throwIfAborted();
		if (existsSync(destination)) return false;
		try {
			mkdirSync(lockPath);
			return true;
		} catch (error) {
			if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(lockPath).mtimeMs > INSTALL_LOCK_STALE_MS) {
					rmSync(lockPath, { force: true, recursive: true });
					continue;
				}
			} catch (statError) {
				if (!statError || typeof statError !== "object" || !("code" in statError) || statError.code !== "ENOENT") {
					throw statError;
				}
			}
			await delay(INSTALL_LOCK_POLL_MS, undefined, signal ? { signal } : undefined);
		}
	}
	if (existsSync(destination)) return false;
	throw new Error(`Timed out waiting for Code Mode host install lock: ${lockPath}`);
}

export async function installCodeModeHost(options: InstallCodeModeHostOptions): Promise<void> {
	const [assetName, expectedSha256] = resolveCodeModeHostAsset(options.platform, options.arch);
	const binaryName = codeModeHostBinaryName(options.platform);
	const destination = resolve(options.destination);
	if (basename(destination) !== binaryName) {
		throw new Error(`Code Mode host destination must end with ${binaryName}`);
	}
	if (existsSync(destination)) return;
	mkdirSync(resolve(destination, ".."), { recursive: true });
	const lockPath = `${destination}.lock`;
	if (!(await acquireInstallLock(lockPath, destination, options.signal))) return;

	let temporary: string | undefined;
	const staged = `${destination}.${String(process.pid)}.tmp`;
	try {
		temporary = mkdtempSync(join(options.temporaryDirectory ?? tmpdir(), "pi-stuff-code-mode-"));
		const assetUrl = hostAssetUrl(assetName);
		let bytes: Buffer;
		try {
			const timeoutSignal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
			const proxy = getProxyForUrl(assetUrl);
			const response = await fetch(assetUrl, {
				redirect: "follow",
				signal: options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal,
				...(proxy ? { proxy } : {}),
			} as RequestInit & { proxy?: string });
			if (!response.ok) throw new Error(`${String(response.status)} ${response.statusText}`);
			bytes = Buffer.from(await response.arrayBuffer());
		} catch (error) {
			throw new Error(
				`Code Mode host download failed for ${assetUrl}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		}
		const actualSha256 = createHash("sha256").update(bytes).digest("hex");
		if (actualSha256 !== expectedSha256) throw new Error(`Code Mode host checksum mismatch for ${assetName}`);

		if (options.platform === "win32") {
			writeFileSync(staged, bytes);
		} else {
			const archive = join(temporary, basename(assetName));
			const extracted = join(temporary, "extracted");
			writeFileSync(archive, bytes);
			mkdirSync(extracted);
			const extraction = spawnSync("tar", ["-xzf", archive, "-C", extracted], { stdio: "pipe" });
			options.signal?.throwIfAborted();
			if (extraction.status !== 0) {
				throw new Error(`Code Mode host archive extraction failed: ${extraction.stderr.toString().trim()}`);
			}
			const candidates = walk(extracted).filter((path) => basename(path).startsWith("codex-code-mode-host"));
			if (candidates.length !== 1) {
				throw new Error(`Expected one Code Mode host binary, found ${String(candidates.length)}`);
			}
			copyFileSync(candidates[0] ?? "", staged);
			chmodSync(staged, 0o755);
		}
		renameSync(staged, destination);
	} finally {
		rmSync(staged, { force: true });
		if (temporary) rmSync(temporary, { force: true, recursive: true });
		rmSync(lockPath, { force: true, recursive: true });
	}
}
