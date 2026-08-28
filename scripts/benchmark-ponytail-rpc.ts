import { spawn } from "node:child_process";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as delay } from "node:timers/promises";
import {
	type JsonInputObject,
	type JsonSourceObject,
	parseJsonObject,
} from "../packages/pi-stuff/src/shared/json-value.js";

const ROOT = resolve(import.meta.dir, "..");
const PONYTAIL_PACKAGE = join(ROOT, "packages/pi-stuff");
const OBSERVER_EXTENSION = join(ROOT, "test/fixtures/ponytail-benchmark-observer.ts");
const COMMAND_TIMEOUT_MS = 60_000;
const CASE_TIMEOUT_MS = 15 * 60_000;

export const PONYTAIL_BENCHMARK_PROVIDER = "jcapi";
export const PONYTAIL_BENCHMARK_MODEL = "openrouter/stealth/ox-alpha";

interface RpcWaiter {
	readonly after: number;
	readonly predicate: (event: JsonSourceObject) => boolean;
	readonly reject: (error: Error) => void;
	readonly resolve: (event: JsonSourceObject) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

function fail(message: string): never {
	throw new Error(`Ponytail behavior benchmark failed: ${message}`);
}

export function buildPonytailBenchmarkEnvironment(
	base: NodeJS.ProcessEnv,
	runtime: string,
	temporary: string,
	observerLog: string,
): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {
		...base,
		XDG_RUNTIME_DIR: runtime,
		TMPDIR: temporary,
		PI_STUFF_CODE_MODE_DEFAULT: "off",
		PI_STUFF_PONYTAIL_BENCHMARK_LOG: observerLog,
	};
	for (const key of Object.keys(environment)) {
		if (
			key.startsWith("PONYTAIL_") ||
			key.startsWith("PI_SUBAGENT_PARENT_") ||
			key === "PI_STUFF_PONYTAIL_MODE" ||
			key === "PI_STUFF_CODE_MODE_FROZEN"
		) {
			delete environment[key];
		}
	}
	environment["PONYTAIL_DEFAULT_MODE"] = "off";
	environment["PONYTAIL_HIDE_STATUS"] = "0";
	environment["PONYTAIL_QUIET_STARTUP"] = "1";
	return environment;
}

export class PonytailBenchmarkRpc {
	readonly events: JsonSourceObject[] = [];
	private buffer = "";
	private closePromise: Promise<void> | undefined;
	private readonly decoder = new StringDecoder("utf8");
	private errorOutput = "";
	private requestSequence = 0;
	private readonly waiters = new Set<RpcWaiter>();
	private readonly child;

	constructor(project: string, sessions: string, runtime: string, temporary: string, observerLog: string) {
		this.child = spawn(
			process.env["PI_BIN"] ?? "/opt/pi-coding-agent/pi",
			[
				"--mode",
				"rpc",
				"--approve",
				"--no-extensions",
				"--no-context-files",
				"--no-prompt-templates",
				"--no-skills",
				"--extension",
				PONYTAIL_PACKAGE,
				"--extension",
				OBSERVER_EXTENSION,
				"--tools",
				"read,write,edit,bash",
				"--provider",
				PONYTAIL_BENCHMARK_PROVIDER,
				"--model",
				PONYTAIL_BENCHMARK_MODEL,
				"--thinking",
				"medium",
				"--session-dir",
				sessions,
			],
			{
				cwd: project,
				env: buildPonytailBenchmarkEnvironment(process.env, runtime, temporary, observerLog),
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		this.child.stdout.on("data", (chunk: Buffer) => this.readStdout(chunk));
		this.child.stderr.on("data", (chunk: Buffer) => {
			this.errorOutput = (this.errorOutput + chunk.toString("utf8")).slice(-12_000);
		});
		this.child.once("exit", (code) => this.rejectWaiters(`Pi RPC exited unexpectedly with ${String(code)}`));
	}

	async command(payload: JsonInputObject, timeoutMs = COMMAND_TIMEOUT_MS): Promise<JsonSourceObject> {
		const requestId = `request-${String(++this.requestSequence)}`;
		const pending = this.waitFor(
			this.events.length,
			(event) => event["type"] === "response" && event["id"] === requestId,
			timeoutMs,
			requestId,
		);
		this.child.stdin.write(`${JSON.stringify({ id: requestId, ...payload })}\n`);
		const response = await pending;
		if (response["success"] !== true) fail(`Pi RPC command failed: ${String(response["error"])}`);
		return response;
	}

	async promptAndSettle(message: string): Promise<void> {
		const settled = this.waitFor(
			this.events.length,
			(event) => event["type"] === "agent_settled",
			CASE_TIMEOUT_MS,
			"agent_settled",
		);
		await this.command({ type: "prompt", message });
		await settled;
	}

	close(): Promise<void> {
		this.closePromise ??= this.closeProcess();
		return this.closePromise;
	}

	stderr(): string {
		return this.errorOutput;
	}

	private dispatch(event: JsonSourceObject): void {
		this.events.push(event);
		for (const waiter of this.waiters) {
			if (this.events.length <= waiter.after || !waiter.predicate(event)) continue;
			clearTimeout(waiter.timer);
			this.waiters.delete(waiter);
			waiter.resolve(event);
		}
	}

	private readStdout(chunk: Buffer): void {
		this.buffer += this.decoder.write(chunk);
		while (true) {
			const newline = this.buffer.indexOf("\n");
			if (newline < 0) break;
			const line = this.buffer.slice(0, newline).replace(/\r$/u, "");
			this.buffer = this.buffer.slice(newline + 1);
			if (!line) continue;
			try {
				this.dispatch(parseJsonObject(line));
			} catch {
				this.rejectWaiters("Pi RPC emitted malformed JSON");
			}
		}
	}

	private rejectWaiters(message: string): void {
		for (const waiter of this.waiters) {
			clearTimeout(waiter.timer);
			waiter.reject(new Error(message));
		}
		this.waiters.clear();
	}

	private waitFor(
		after: number,
		predicate: (event: JsonSourceObject) => boolean,
		timeoutMs: number,
		label: string,
	): Promise<JsonSourceObject> {
		for (let index = after; index < this.events.length; index++) {
			const event = this.events[index];
			if (event && predicate(event)) return Promise.resolve(event);
		}
		return new Promise((resolvePromise, reject) => {
			const waiter = {
				after,
				predicate,
				resolve: resolvePromise,
				reject,
				timer: setTimeout(() => {
					this.waiters.delete(waiter);
					reject(new Error(`timed out waiting for ${label}`));
				}, timeoutMs),
			};
			this.waiters.add(waiter);
		});
	}

	private async closeProcess(): Promise<void> {
		if (this.child.exitCode !== null) return;
		this.child.stdin.end();
		await this.signalAndWait("SIGTERM");
		if (this.child.exitCode !== null) return;
		await this.signalAndWait("SIGKILL");
		if (this.child.exitCode === null) fail("Pi RPC process did not terminate");
	}

	private async signalAndWait(signal: NodeJS.Signals): Promise<void> {
		this.child.kill(signal);
		await Promise.race([once(this.child, "exit"), delay(5_000)]);
	}
}
