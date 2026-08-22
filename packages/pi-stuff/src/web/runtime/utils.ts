import type { JsonInputObject, JsonInputValue } from "../../shared/json-value.js";
import { isJsonInputObject } from "../../shared/json-value.js";
import { isRuntimeObject, isRuntimeString } from "../../shared/runtime-type.js";
import { hostname } from "node:os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getWebConfigPath, readWebConfig } from "../settings.ts";

export function getWebSearchConfigDir(): string {
	return getAgentDir();
}

export function getWebSearchConfigPath(): string {
	return getWebConfigPath();
}

export interface CuratorNetworkConfig {
	/** Whether remote access was opted into via curatorRemote. */
	enabled: boolean;
	host: string;
	bind: string;
}

const LOCAL_CURATOR_NETWORK_DEFAULTS: CuratorNetworkConfig = { enabled: false, host: "localhost", bind: "127.0.0.1" };

function trimmedString(value: JsonInputValue): string | undefined {
	if (!isRuntimeString(value)) return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** Resolves the curator server bind address and URL host from `curatorRemote`. */
export function resolveCuratorNetworkConfig(): CuratorNetworkConfig {
	let raw: JsonInputObject | undefined;
	try {
		raw = readWebConfig();
	} catch {
		return LOCAL_CURATOR_NETWORK_DEFAULTS;
	}
	if (!raw) return LOCAL_CURATOR_NETWORK_DEFAULTS;

	const curatorRemote = raw.curatorRemote;
	if (curatorRemote === true) return { enabled: true, host: hostname(), bind: "0.0.0.0" };

	if (isJsonInputObject(curatorRemote)) {
		return {
			enabled: true,
			host: trimmedString(curatorRemote.host) ?? hostname(),
			bind: trimmedString(curatorRemote.bind) ?? "0.0.0.0",
		};
	}

	return LOCAL_CURATOR_NETWORK_DEFAULTS;
}

export function formatSeconds(s: number): string {
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
	return `${m}:${String(sec).padStart(2, "0")}`;
}

export interface ExecErrorDetails {
	code?: string;
	stderr: string;
	message: string;
}

export type ExecErrorInput =
	| Error
	| JsonInputValue
	| {
		code?: JsonInputValue;
		killed?: JsonInputValue;
		message?: JsonInputValue;
		name?: JsonInputValue;
		stderr?: Buffer | JsonInputValue;
	};

export function readExecError(err: ExecErrorInput): ExecErrorDetails {
	if (!err || !isRuntimeObject(err)) {
		return { stderr: "", message: String(err) };
	}
	const code = "code" in err && isRuntimeString(err.code) ? err.code : undefined;
	const message = "message" in err && isRuntimeString(err.message) ? err.message : "";
	const stderrRaw = "stderr" in err ? err.stderr : undefined;
	const stderr = Buffer.isBuffer(stderrRaw)
		? stderrRaw.toString("utf-8")
		: isRuntimeString(stderrRaw)
			? stderrRaw
			: "";
	return { code, stderr, message };
}

export function isTimeoutError(err: ExecErrorInput): boolean {
	if (!err || !isRuntimeObject(err)) return false;
	if ("killed" in err && err.killed === true) return true;
	const name = "name" in err && isRuntimeString(err.name) ? err.name : undefined;
	const code = "code" in err && isRuntimeString(err.code) ? err.code : undefined;
	const message = "message" in err && isRuntimeString(err.message) ? err.message : "";
	return name === "AbortError" || code === "ETIMEDOUT" || message.toLowerCase().includes("timed out");
}

export function trimErrorText(text: string): string {
	return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

export function mapFfmpegError(err: ExecErrorInput): string {
	const { code, stderr, message } = readExecError(err);
	if (code === "ENOENT") return "ffmpeg is not installed. Install with: brew install ffmpeg";
	if (isTimeoutError(err)) return "ffmpeg timed out extracting frame";
	if (stderr.includes("403")) return "Stream URL returned 403 — may have expired, try again";
	const snippet = trimErrorText(stderr || message);
	return snippet ? `ffmpeg failed: ${snippet}` : "ffmpeg failed";
}
