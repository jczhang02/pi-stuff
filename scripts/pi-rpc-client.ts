import { spawn } from "node:child_process";
import { once } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as delay } from "node:timers/promises";
import {
	type JsonInputObject,
	type JsonSourceObject,
	parseJsonObject,
} from "../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";

interface RpcWaiter {
	readonly after: number;
	readonly predicate: (event: JsonSourceObject) => boolean;
	readonly reject: (error: Error) => void;
	readonly resolve: (event: JsonSourceObject) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

export interface PiRpcClientOptions {
	readonly arguments: readonly string[];
	readonly commandTimeoutMs: number;
	readonly cwd: string;
	readonly environment: NodeJS.ProcessEnv;
	readonly executable: string;
	readonly failurePrefix: string;
	readonly settleTimeoutMs: number;
	readonly startupTimeoutMs: number;
}

export class PiRpcTimeoutError extends Error {
	readonly command: string | undefined;
	readonly phase: "command" | "settlement";

	constructor(message: string, phase: "command" | "settlement", command?: string) {
		super(message);
		this.command = command;
		this.name = "PiRpcTimeoutError";
		this.phase = phase;
	}
}

export class PiRpcClient {
	readonly events: JsonSourceObject[] = [];
	private buffer = "";
	private closePromise: Promise<void> | undefined;
	private closing = false;
	private readonly decoder = new StringDecoder("utf8");
	private errorOutput = "";
	private readonly options: PiRpcClientOptions;
	private processFailed = false;
	private requestSequence = 0;
	private terminalFailure: string | undefined;
	private readonly waiters = new Set<RpcWaiter>();
	private readonly child;

	constructor(options: PiRpcClientOptions) {
		this.options = options;
		this.child = spawn(options.executable, [...options.arguments], {
			cwd: options.cwd,
			env: options.environment,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child.once("error", () => {
			this.processFailed = true;
			this.recordTerminalFailure("Pi RPC process error");
		});
		this.child.stdin.on("error", () => this.recordTerminalFailure("Pi RPC stdin error"));
		this.child.stdout.on("data", (chunk: Buffer) => this.readStdout(chunk));
		this.child.stderr.on("data", (chunk: Buffer) => {
			this.errorOutput = (this.errorOutput + chunk.toString("utf8")).slice(-12_000);
		});
		this.child.once("exit", (code) => {
			if (!this.closing) this.recordTerminalFailure(`Pi RPC exited unexpectedly with ${String(code)}`);
		});
	}

	async command(payload: JsonInputObject, timeoutMs = this.options.commandTimeoutMs): Promise<JsonSourceObject> {
		if (this.terminalFailure) this.fail(this.terminalFailure);
		if (this.closing) this.fail("Pi RPC process is closed");
		const command = isRuntimeString(payload["type"]) ? payload["type"] : "unknown";
		const requestId = `request-${String(++this.requestSequence)}`;
		const pending = this.waitFor(
			this.events.length,
			(event) => event["type"] === "response" && event["id"] === requestId,
			timeoutMs,
			`${command} response`,
			"command",
			command,
		);
		this.child.stdin.write(`${JSON.stringify({ id: requestId, ...payload })}\n`);
		const response = await pending;
		if (response["success"] !== true) this.fail(`Pi RPC command failed: ${String(response["error"])}`);
		return response;
	}

	getInitialState(): Promise<JsonSourceObject> {
		return this.command({ type: "get_state" }, this.options.startupTimeoutMs);
	}

	async promptAndSettle(message: string): Promise<void> {
		const settled = this.waitFor(
			this.events.length,
			(event) => event["type"] === "agent_settled",
			this.options.settleTimeoutMs,
			"agent_settled",
			"settlement",
		);
		await this.command({ type: "prompt", message });
		await settled;
	}

	close(): Promise<void> {
		this.closing = true;
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

	private fail(message: string): never {
		throw new Error(`${this.options.failurePrefix}: ${message}`);
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

	private recordTerminalFailure(message: string): void {
		this.terminalFailure ??= message;
		this.rejectWaiters(this.terminalFailure);
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
		phase: "command" | "settlement",
		command?: string,
	): Promise<JsonSourceObject> {
		for (let index = after; index < this.events.length; index += 1) {
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
					reject(new PiRpcTimeoutError(`timed out waiting for ${label}`, phase, command));
				}, timeoutMs),
			};
			this.waiters.add(waiter);
		});
	}

	private async closeProcess(): Promise<void> {
		if (this.processExited()) return;
		this.child.stdin.end();
		await this.signalAndWait("SIGTERM");
		if (this.processExited()) return;
		await this.signalAndWait("SIGKILL");
		if (!this.processExited()) this.fail("Pi RPC process did not terminate");
	}

	private processExited(): boolean {
		return this.processFailed || this.child.exitCode !== null || this.child.signalCode !== null;
	}

	private async signalAndWait(signal: NodeJS.Signals): Promise<void> {
		if (this.processExited()) return;
		this.child.kill(signal);
		if (this.processExited()) return;
		await Promise.race([once(this.child, "exit"), delay(5_000)]);
	}
}
