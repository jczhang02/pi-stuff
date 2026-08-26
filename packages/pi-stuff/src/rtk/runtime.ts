import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { boundTerminalLine } from "../tool-display/index.js";

const RESOLVE_TIMEOUT_MS = 600;
const VERSION_TIMEOUT_MS = 1_000;
const REWRITE_TIMEOUT_MS = 2_500;

export const CERTIFIED_RTK_VERSION = "0.45.0";
export const CERTIFIED_RTK_LINUX_X64_SHA256 = "99e0cff729d52297a23eb832f809d9773ba7c32de818dfe76b2cdd900a951535";

export type RtkRuntimeState = "drifted" | "ready" | "unavailable" | "unchecked";

export interface RtkRuntimeSnapshot {
	readonly lastError?: string;
	readonly path?: string;
	readonly sha256?: string;
	readonly state: RtkRuntimeState;
	readonly version?: string;
}

export interface RtkRuntimeOptions {
	readonly expectedSha256?: string;
	readonly expectedVersion?: string;
	readonly platform?: NodeJS.Platform;
	readonly resolveTimeoutMs?: number;
	readonly rewriteTimeoutMs?: number;
	readonly versionTimeoutMs?: number;
}

interface RuntimeCertificate {
	readonly fingerprint: string;
	readonly path: string;
	readonly selectedPath: string;
	readonly sha256: string;
	readonly version: string;
}

interface VerifyOptions {
	readonly refresh?: boolean;
	readonly signal?: AbortSignal;
}

function cleanOneLine(cause: unknown): string {
	const text = cause instanceof Error ? cause.message : String(cause);
	return boundTerminalLine(text, 220);
}

function firstNonEmptyLine(value: string): string | undefined {
	return value
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.find(Boolean);
}

function parseVersion(value: string): string | undefined {
	return value.match(/(?:^|\s)rtk\s+v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\s|$)/u)?.[1];
}

function effectiveCommandStartsWithRtk(command: string): boolean {
	const withoutAssignments = command
		.trimStart()
		.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*/u, "");
	return withoutAssignments === "rtk" || withoutAssignments.startsWith("rtk ");
}

async function sha256File(path: string): Promise<string> {
	return createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
}

async function fileFingerprint(path: string): Promise<string> {
	const info = await stat(path);
	if (!info.isFile()) throw new Error("resolved RTK path is not a regular file");
	return [info.dev, info.ino, info.size, info.mtimeMs, info.mode].join(":");
}

function defaultExpectedSha256s(platform: NodeJS.Platform): readonly string[] {
	return platform === "linux" && process.arch === "x64" ? [CERTIFIED_RTK_LINUX_X64_SHA256] : [];
}

/** Certifies one local RTK executable and fails open whenever that identity changes. */
export class RtkRuntime {
	private certificate: RuntimeCertificate | undefined;
	private readonly expectedSha256s: ReadonlySet<string>;
	private readonly expectedVersion: string;
	private readonly platform: NodeJS.Platform;
	private readonly resolveTimeoutMs: number;
	private readonly rewriteTimeoutMs: number;
	private snapshotValue: RtkRuntimeSnapshot = { state: "unchecked" };
	private verification: Promise<RtkRuntimeSnapshot> | undefined;
	private readonly versionTimeoutMs: number;

	constructor(options: RtkRuntimeOptions = {}) {
		this.platform = options.platform ?? process.platform;
		this.expectedVersion = options.expectedVersion ?? CERTIFIED_RTK_VERSION;
		this.expectedSha256s = new Set(
			options.expectedSha256 ? [options.expectedSha256] : defaultExpectedSha256s(this.platform),
		);
		this.resolveTimeoutMs = options.resolveTimeoutMs ?? RESOLVE_TIMEOUT_MS;
		this.rewriteTimeoutMs = options.rewriteTimeoutMs ?? REWRITE_TIMEOUT_MS;
		this.versionTimeoutMs = options.versionTimeoutMs ?? VERSION_TIMEOUT_MS;
	}

	snapshot(): RtkRuntimeSnapshot {
		return { ...this.snapshotValue };
	}

	reset(): void {
		this.certificate = undefined;
		this.snapshotValue = { state: "unchecked" };
		this.verification = undefined;
	}

	async verify(pi: Pick<ExtensionAPI, "exec">, options: VerifyOptions = {}): Promise<RtkRuntimeSnapshot> {
		if (options.refresh) {
			if (this.verification) await this.verification;
			this.certificate = undefined;
			this.snapshotValue = { state: "unchecked" };
		}
		if (this.certificate) return this.snapshot();
		if (this.snapshotValue.state !== "unchecked") return this.snapshot();
		this.verification ??= this.certify(pi, options.signal).finally(() => {
			this.verification = undefined;
		});
		return this.verification;
	}

	async rewrite(pi: Pick<ExtensionAPI, "exec">, command: string, signal?: AbortSignal): Promise<string | undefined> {
		if (!command.trim() || effectiveCommandStartsWithRtk(command)) return undefined;
		await this.verify(pi, signal ? { signal } : {});
		const certificate = this.certificate;
		if (!certificate) return undefined;

		try {
			await this.assertStable(pi, certificate, signal);
		} catch (error) {
			if (signal?.aborted) return undefined;
			this.markDrifted(error, certificate);
			return undefined;
		}

		try {
			const options = { timeout: this.rewriteTimeoutMs };
			if (signal) Object.assign(options, { signal });
			const result = await pi.exec(certificate.path, ["rewrite", command], options);
			if (result.code === 1 || result.code === 2) return undefined;
			if (result.code !== 0 && result.code !== 3) {
				if (result.killed) this.markUnavailable("RTK rewrite timed out", certificate);
				return undefined;
			}
			const rewritten = result.stdout.trim();
			return rewritten && rewritten !== command ? rewritten : undefined;
		} catch (error) {
			if (!signal?.aborted) this.markUnavailable(`RTK rewrite failed: ${cleanOneLine(error)}`, certificate);
			return undefined;
		}
	}

	private async certify(pi: Pick<ExtensionAPI, "exec">, signal?: AbortSignal): Promise<RtkRuntimeSnapshot> {
		try {
			const selectedPath = await this.resolveSelectedPath(pi, signal);
			const path = await realpath(selectedPath);
			const versionOptions = { timeout: this.versionTimeoutMs };
			if (signal) Object.assign(versionOptions, { signal });
			const [fingerprint, sha256, versionResult] = await Promise.all([
				fileFingerprint(path),
				sha256File(path),
				pi.exec(path, ["--version"], versionOptions),
			]);
			const version = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
			if (versionResult.code !== 0 || !version) throw new Error("RTK returned no valid version");
			if (version !== this.expectedVersion) {
				throw new Error(`RTK ${version} is not the certified ${this.expectedVersion} runtime`);
			}
			if (this.expectedSha256s.size === 0) {
				throw new Error(`RTK has no certified runtime for ${this.platform}/${process.arch}`);
			}
			if (!this.expectedSha256s.has(sha256)) {
				throw new Error("RTK executable SHA-256 does not match the certified runtime");
			}
			this.certificate = { fingerprint, path, selectedPath, sha256, version };
			this.snapshotValue = { path, sha256, state: "ready", version };
		} catch (error) {
			if (signal?.aborted) {
				this.snapshotValue = { state: "unchecked" };
			} else {
				this.markUnavailable(`RTK verification failed: ${cleanOneLine(error)}`);
			}
		}
		return this.snapshot();
	}

	private async assertStable(
		pi: Pick<ExtensionAPI, "exec">,
		certificate: RuntimeCertificate,
		signal?: AbortSignal,
	): Promise<void> {
		const selectedPath = await this.resolveSelectedPath(pi, signal);
		const path = await realpath(selectedPath);
		if (selectedPath !== certificate.selectedPath || path !== certificate.path) {
			throw new Error("resolved RTK path changed after verification");
		}
		const [fingerprint, sha256] = await Promise.all([fileFingerprint(path), sha256File(path)]);
		if (fingerprint !== certificate.fingerprint || sha256 !== certificate.sha256) {
			throw new Error("RTK executable changed after verification");
		}
	}

	private async resolveSelectedPath(pi: Pick<ExtensionAPI, "exec">, signal?: AbortSignal): Promise<string> {
		const resolver = this.platform === "win32" ? "where" : "which";
		const options = { timeout: this.resolveTimeoutMs };
		if (signal) Object.assign(options, { signal });
		const result = await pi.exec(resolver, ["rtk"], options);
		const selectedPath = firstNonEmptyLine(result.stdout);
		if (result.code !== 0 || !selectedPath) throw new Error(`${resolver} could not resolve rtk`);
		return selectedPath.replace(/^(["'])(.*)\1$/u, "$2");
	}

	private markDrifted(cause: unknown, certificate: RuntimeCertificate): void {
		this.certificate = undefined;
		this.snapshotValue = {
			lastError: `RTK identity drift: ${cleanOneLine(cause)}`,
			path: certificate.path,
			sha256: certificate.sha256,
			state: "drifted",
			version: certificate.version,
		};
	}

	private markUnavailable(error: string, certificate?: RuntimeCertificate): void {
		this.certificate = undefined;
		const snapshot = {
			lastError: error,
			state: "unavailable" as const,
		};
		if (certificate) {
			Object.assign(snapshot, { path: certificate.path, sha256: certificate.sha256, version: certificate.version });
		}
		this.snapshotValue = snapshot;
	}
}
