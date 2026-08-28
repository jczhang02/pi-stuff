/** Build and supervise the detached process group for one Agent writer. */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { PONYTAIL_CHILD_MODE_ENV } from "../../../../ponytail/types.js";
import { parseJsonValue } from "../../../../shared/json-value.js";
import { runtimeErrorCode } from "../../../../shared/runtime-type.js";
import { readBoundedOwnedFile } from "../../shared/private-directory.ts";
import {
	identityBoundProcessLiveness,
	type ProcessStartIdentityPollOptions,
	pollProcessStartIdentity,
	probeProcessLiveness,
	processExists,
	readProcessStartIdentity,
} from "../../shared/process-identity.ts";
import { getSubagentDepthEnv } from "../../shared/types.ts";
import { resolveBunRuntimeCommand } from "../shared/bun-runtime.ts";
import type { BackgroundRunnerConfig } from "../shared/parallel-utils.ts";

export const BACKGROUND_RUNNER_SENTINEL_ENV = "PI_STUFF_BACKGROUND_RUNNER";
export const BACKGROUND_RUNNER_CONFIG_ENV = "PI_STUFF_BACKGROUND_RUNNER_CONFIG";

/** Runner identity must never leak into a Pi writer process. */
export function ponytailWriterEnvironmentOverrides(mode: BackgroundRunnerConfig["ponytailMode"]) {
	return { [PONYTAIL_CHILD_MODE_ENV]: mode };
}

export function buildWriterProcessEnv(
	parentEnv: NodeJS.ProcessEnv,
	overrides: Record<string, string | undefined>,
	maxSubagentDepth?: number,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...parentEnv,
		...overrides,
		...getSubagentDepthEnv(maxSubagentDepth, parentEnv),
	};
	for (const [name, value] of Object.entries(overrides)) {
		if (value === undefined) delete env[name];
	}
	delete env[BACKGROUND_RUNNER_SENTINEL_ENV];
	delete env[BACKGROUND_RUNNER_CONFIG_ENV];
	return env;
}

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

const WRITER_SUPERVISOR_DISPOSITION_SCHEMA = Type.Object(
	{
		version: Type.Literal(1),
		supervisorPid: Type.Integer({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
		supervisorProcessStartIdentity: Type.String({ minLength: 1 }),
		childPid: Type.Integer({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
		childProcessStartIdentity: Type.String({ minLength: 1 }),
		exitCode: Type.Union([Type.Number(), Type.Null()]),
		signal: Type.Union([Type.String(), Type.Null()]),
		origin: Type.Union([
			Type.Literal("external"),
			Type.Literal("manager-final-drain"),
			Type.Literal("manager-request"),
			Type.Null(),
		]),
		reaped: Type.Boolean(),
		outputForwardingError: Type.Optional(Type.String({ maxLength: 1_000 })),
	},
	{ additionalProperties: false },
);
type WriterSupervisorDisposition = Static<typeof WRITER_SUPERVISOR_DISPOSITION_SCHEMA>;

export function readWriterSupervisorDisposition(
	filePath: string,
	supervisorPid: number | undefined,
	supervisorProcessStartIdentity: string | undefined,
): WriterSupervisorDisposition | undefined {
	if (supervisorPid === undefined || !supervisorProcessStartIdentity) return undefined;
	try {
		const value = Value.Clean(
			WRITER_SUPERVISOR_DISPOSITION_SCHEMA,
			parseJsonValue(readBoundedOwnedFile(filePath, 8 * 1024)),
		);
		if (
			!Value.Check(WRITER_SUPERVISOR_DISPOSITION_SCHEMA, value) ||
			value.supervisorPid !== supervisorPid ||
			value.supervisorProcessStartIdentity !== supervisorProcessStartIdentity
		)
			return undefined;
		return value;
	} catch {
		return undefined;
	}
}

function writerProcessGroupAlive(pid: number): boolean | undefined {
	if (process.platform === "win32") return false;
	return probeProcessLiveness(-pid);
}

function ownedWriterProcessGroupAlive(pid: number, expectedProcessStartIdentity?: string): boolean | undefined {
	return identityBoundProcessLiveness(pid, expectedProcessStartIdentity, writerProcessGroupAlive(pid));
}

export async function captureWriterProcessStartIdentity(
	pid: number,
	options: ProcessStartIdentityPollOptions = {},
): Promise<string | undefined> {
	return pollProcessStartIdentity(pid, processExists, options);
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
