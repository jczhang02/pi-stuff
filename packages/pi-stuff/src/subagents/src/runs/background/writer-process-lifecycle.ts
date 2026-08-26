/** Build and supervise the detached process group for one Agent writer. */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonValue } from "../../../../shared/json-value.js";
import {
	isRuntimeBoolean,
	isRuntimeNumber,
	isRuntimeObject,
	isRuntimeString,
	runtimeErrorCode,
} from "../../../../shared/runtime-type.js";
import { readBoundedOwnedFile } from "../../shared/private-directory.ts";
import { readProcessStartIdentity } from "../../shared/process-identity.ts";
import { resolveBunRuntimeCommand } from "../shared/bun-runtime.ts";

interface WriterSupervisorEnvelope {
	command: string;
	args: string[];
	parentPid: number;
	parentStarted: string;
	dispositionPath?: string | undefined;
	groupMemberProofPath?: string | undefined;
	controlPath?: string;
	controlToken?: string;
}
export function buildWriterSpawnCommand(
	command: string,
	args: readonly string[],
	platform: NodeJS.Platform = process.platform,
	dispositionPath?: string,
	groupMemberProofPath?: string,
	writerSupervisorRuntime = resolveBunRuntimeCommand(),
	control?: { readonly path: string; readonly token: string },
) {
	if (platform === "win32") return { command, args: [...args], gated: false };
	const parentStarted = readProcessStartIdentity(process.pid);
	if (!parentStarted) throw new Error("Agent writer supervisor requires a stable runner process identity.");
	if (!writerSupervisorRuntime) {
		throw new Error("Bun is required to launch the Agent writer supervisor, but no executable was found.");
	}
	const supervisor = path.join(path.dirname(fileURLToPath(import.meta.url)), "writer-process-supervisor.mjs");
	const supervisorEnvelope: WriterSupervisorEnvelope = {
		command,
		args: [...args],
		parentPid: process.pid,
		parentStarted,
		dispositionPath,
		groupMemberProofPath,
	};
	if (control) {
		supervisorEnvelope.controlPath = control.path;
		supervisorEnvelope.controlToken = control.token;
	}
	const envelope = Buffer.from(JSON.stringify(supervisorEnvelope), "utf-8").toString("base64url");
	return {
		command: writerSupervisorRuntime,
		args: [supervisor, envelope],
		gated: true,
	};
}

interface WriterSupervisorDisposition {
	version: 1;
	supervisorPid: number;
	supervisorProcessStartIdentity: string;
	childPid: number;
	childProcessStartIdentity: string;
	exitCode: number | null;
	signal: string | null;
	origin: "external" | "manager-final-drain" | "manager-request" | null;
	reaped: boolean;
	outputForwardingError?: string;
}

export function readWriterSupervisorDisposition(
	filePath: string,
	supervisorPid: number | undefined,
	supervisorProcessStartIdentity: string | undefined,
): WriterSupervisorDisposition | undefined {
	if (supervisorPid === undefined || !supervisorProcessStartIdentity) return undefined;
	try {
		const value = parseJsonValue(readBoundedOwnedFile(filePath, 8 * 1024));
		if (
			!isRuntimeObject(value) ||
			value === null ||
			Array.isArray(value) ||
			value["version"] !== 1 ||
			value["supervisorPid"] !== supervisorPid ||
			value["supervisorProcessStartIdentity"] !== supervisorProcessStartIdentity ||
			!isRuntimeNumber(value["childPid"]) ||
			!Number.isSafeInteger(value["childPid"]) ||
			!isRuntimeString(value["childProcessStartIdentity"]) ||
			!value["childProcessStartIdentity"] ||
			(!isRuntimeNumber(value["exitCode"]) && value["exitCode"] !== null) ||
			(!isRuntimeString(value["signal"]) && value["signal"] !== null) ||
			(value["origin"] !== null &&
				value["origin"] !== "external" &&
				value["origin"] !== "manager-final-drain" &&
				value["origin"] !== "manager-request") ||
			!isRuntimeBoolean(value["reaped"]) ||
			(value["outputForwardingError"] !== undefined &&
				(!isRuntimeString(value["outputForwardingError"]) || value["outputForwardingError"].length > 1_000))
		)
			return undefined;
		const disposition: WriterSupervisorDisposition = {
			version: 1,
			supervisorPid,
			supervisorProcessStartIdentity,
			childPid: value["childPid"],
			childProcessStartIdentity: value["childProcessStartIdentity"],
			exitCode: value["exitCode"],
			signal: value["signal"],
			origin: value["origin"],
			reaped: value["reaped"],
		};
		if (value["outputForwardingError"] !== undefined) {
			disposition.outputForwardingError = value["outputForwardingError"];
		}
		return disposition;
	} catch {
		return undefined;
	}
}

function writerProcessGroupAlive(pid: number): boolean | undefined {
	if (process.platform === "win32") return false;
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		const code = runtimeErrorCode(error);
		if (code === "ESRCH") return false;
		return undefined;
	}
}

function ownedWriterProcessGroupAlive(pid: number, expectedProcessStartIdentity?: string): boolean | undefined {
	const groupState = writerProcessGroupAlive(pid);
	if (groupState !== true) return groupState;
	if (!expectedProcessStartIdentity) return undefined;
	const currentIdentity = readProcessStartIdentity(pid);
	if (currentIdentity) return currentIdentity === expectedProcessStartIdentity;
	return undefined;
}

export async function captureWriterProcessStartIdentity(
	pid: number,
	options: {
		readonly read?: (pid: number) => string | undefined;
		readonly timeoutMs?: number;
		readonly intervalMs?: number;
	} = {},
): Promise<string | undefined> {
	const read = options.read ?? readProcessStartIdentity;
	const deadline = Date.now() + (options.timeoutMs ?? 250);
	do {
		const identity = read(pid);
		if (identity) return identity;
		try {
			process.kill(pid, 0);
		} catch (error) {
			if (runtimeErrorCode(error) !== "EPERM") return undefined;
		}
		if (Date.now() >= deadline) return undefined;
		await new Promise<void>((resolve) => setTimeout(resolve, options.intervalMs ?? 20));
	} while (Date.now() <= deadline);
	return undefined;
}

export async function closeWriterProcessGroup(pid: number, expectedProcessStartIdentity?: string): Promise<boolean> {
	if (process.platform === "win32") return true;
	for (const signal of ["SIGTERM", "SIGKILL"] as const) {
		const state = ownedWriterProcessGroupAlive(pid, expectedProcessStartIdentity);
		if (state === false) return true;
		if (state === undefined) return false;
		try {
			process.kill(-pid, signal);
		} catch (error) {
			if (runtimeErrorCode(error) === "ESRCH") return true;
			return false;
		}
		const deadline = Date.now() + 500;
		while (Date.now() < deadline) {
			if (ownedWriterProcessGroupAlive(pid, expectedProcessStartIdentity) === false) return true;
			await new Promise<void>((resolve) => setTimeout(resolve, 20));
		}
	}
	return ownedWriterProcessGroupAlive(pid, expectedProcessStartIdentity) === false;
}
