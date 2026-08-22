import { open, stat } from "node:fs/promises";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRuntimeObject } from "../../shared/runtime-type.js";
import { boundTerminalLine } from "../../tool-display/index.js";
import { sanitizeTerminalText, utf8SafePrefix, utf8SafeTail } from "./output.js";
import type {
	BackgroundMonitorActivity,
	BackgroundWorkOutcome,
	BackgroundWorkRuntime,
	BackgroundWorkSnapshot,
} from "./runtime.js";

const DEFAULT_INTERVAL_SECONDS = 2;
const DEFAULT_TIMEOUT_SECONDS = 600;
const MAX_EVIDENCE_BYTES = 64 * 1024;

type MonitorSource = "command" | "file" | "http" | "log";

export interface MonitorInput {
	readonly description?: string;
	readonly failureText?: string;
	readonly intervalSeconds?: number;
	readonly source: MonitorSource;
	readonly startAtEnd?: boolean;
	readonly successText?: string;
	readonly target: string;
	readonly timeoutSeconds?: number;
	readonly toolCallId: string;
}

export interface StartedMonitor {
	readonly id: string;
	readonly outputPath?: string;
	readonly title: string;
}

interface ProbeResult {
	readonly evidence: string;
	readonly state: "failed" | "pending" | "satisfied";
}

function boundedSeconds(value: number | undefined, fallback: number, name: string, maximum: number): number {
	const selected = value ?? fallback;
	if (!Number.isFinite(selected) || selected <= 0 || selected > maximum) {
		throw new Error(`${name} must be greater than 0 and no more than ${String(maximum)} seconds`);
	}
	return selected;
}

function titleFor(input: MonitorInput): string {
	const explicit = boundTerminalLine(input.description, 80);
	if (explicit) return explicit;
	return boundTerminalLine(`${input.source} ${input.target}`, 80);
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, milliseconds);
		const abort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		signal.addEventListener("abort", abort, { once: true });
	});
}

function textCondition(evidence: string, successText?: string, failureText?: string): ProbeResult {
	if (failureText && evidence.includes(failureText)) return { evidence, state: "failed" };
	if (!successText || evidence.includes(successText)) return { evidence, state: "satisfied" };
	return { evidence, state: "pending" };
}

async function readSlice(path: string, fromByte: number): Promise<string> {
	const handle = await open(path, "r");
	try {
		const size = (await handle.stat()).size;
		const start = Math.max(fromByte, size - MAX_EVIDENCE_BYTES);
		const length = Math.max(0, Math.min(MAX_EVIDENCE_BYTES, size - start));
		if (length === 0) return "";
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await handle.read(buffer, 0, length, start);
		const prefix = start > fromByte ? "…[earlier monitored content omitted]\n" : "";
		return sanitizeTerminalText(`${prefix}${utf8SafeTail(buffer, bytesRead).toString("utf-8")}`).trimEnd();
	} finally {
		await handle.close().catch(() => {});
	}
}

async function readResponseBody(response: Response): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const item = await reader.read();
			if (item.done) break;
			const remaining = MAX_EVIDENCE_BYTES - bytes;
			if (remaining <= 0) break;
			const accepted = item.value.subarray(0, remaining);
			chunks.push(accepted);
			bytes += accepted.byteLength;
			if (accepted.byteLength < item.value.byteLength || bytes >= MAX_EVIDENCE_BYTES) break;
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	const combined = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(utf8SafePrefix(Buffer.from(combined)));
}

class PollingMonitor implements BackgroundMonitorActivity {
	readonly id: string;
	readonly outcome: Promise<BackgroundWorkOutcome>;
	private readonly controller = new AbortController();
	private evidence = "Waiting for the condition.";
	private finalized = false;
	private initialOffset = 0;
	private readonly input: MonitorInput;
	private readonly intervalMs: number;
	private outcomeResolve!: (outcome: BackgroundWorkOutcome) => void;
	private readonly startedAt = Date.now();
	private status: "running" | "stopping" = "running";
	private readonly timeoutMs: number;
	private readonly title: string;

	constructor(id: string, input: MonitorInput, intervalMs: number, timeoutMs: number) {
		this.id = id;
		this.input = input;
		this.intervalMs = intervalMs;
		this.timeoutMs = timeoutMs;
		this.title = titleFor(input);
		this.outcome = new Promise((resolve) => {
			this.outcomeResolve = resolve;
		});
	}

	start(): void {
		void this.run();
	}

	readOutput(maxBytes = MAX_EVIDENCE_BYTES): string {
		const buffer = Buffer.from(this.evidence, "utf-8");
		return utf8SafeTail(buffer, maxBytes).toString("utf-8");
	}

	snapshot(): BackgroundWorkSnapshot {
		const snapshot: BackgroundWorkSnapshot = {
			id: this.id,
			kind: "monitor",
			monitorSource: this.input.source,
			monitorTarget: this.input.target,
			monitorTimeoutSeconds: Math.round(this.timeoutMs / 1_000),
			recentOutput: this.evidence,
			startedAt: this.startedAt,
			status: this.status,
			title: this.title,
		};
		if (this.input.description) Object.assign(snapshot, { description: this.input.description });
		if (this.input.failureText) Object.assign(snapshot, { monitorFailureText: this.input.failureText });
		if (this.input.successText) Object.assign(snapshot, { monitorSuccessText: this.input.successText });
		return snapshot;
	}

	async cancel(reason: "shutdown" | "user"): Promise<BackgroundWorkOutcome> {
		if (this.finalized) return this.outcome;
		this.status = "stopping";
		this.controller.abort(reason);
		this.finish("stopped", `Monitor "${this.title}" stopped`);
		return this.outcome;
	}

	private async run(): Promise<void> {
		if (this.input.source === "log" && this.input.startAtEnd !== false) {
			try {
				this.initialOffset = (await stat(this.input.target)).size;
			} catch {
				this.initialOffset = 0;
			}
		}
		const deadline = this.startedAt + this.timeoutMs;
		while (!this.finalized && !this.controller.signal.aborted) {
			if (Date.now() >= deadline) {
				this.finish("timed_out", `Monitor "${this.title}" timed out`);
				return;
			}
			try {
				const result = await this.probe();
				this.evidence = result.evidence || "Condition has not been observed yet.";
				if (result.state === "satisfied") {
					this.finish("completed", `Monitor "${this.title}" observed its condition`);
					return;
				}
				if (result.state === "failed") {
					this.finish("failed", `Monitor "${this.title}" observed its failure condition`);
					return;
				}
			} catch (error) {
				if (this.controller.signal.aborted) return;
				const code = error && isRuntimeObject(error) && "code" in error ? String(error.code) : "";
				if (this.input.source !== "http" && code && code !== "ENOENT") {
					this.evidence = error instanceof Error ? error.message : String(error);
					this.finish("failed", `Monitor "${this.title}" could not read its source`);
					return;
				}
				this.evidence = error instanceof Error ? error.message : String(error);
			}
			try {
				await wait(Math.min(this.intervalMs, Math.max(1, deadline - Date.now())), this.controller.signal);
			} catch {
				return;
			}
		}
	}

	private async probe(): Promise<ProbeResult> {
		if (this.input.source === "http") return this.probeHttp();
		const evidence = await readSlice(this.input.target, this.initialOffset);
		if (!this.input.successText && !this.input.failureText) {
			return { evidence: evidence || `Found ${this.input.target}`, state: "satisfied" };
		}
		return textCondition(evidence, this.input.successText, this.input.failureText);
	}

	private async probeHttp(): Promise<ProbeResult> {
		const attempt = new AbortController();
		const parentAbort = () => attempt.abort(this.controller.signal.reason);
		this.controller.signal.addEventListener("abort", parentAbort, { once: true });
		const timeout = setTimeout(() => attempt.abort(new Error("HTTP probe timed out")), 10_000);
		try {
			const response = await fetch(this.input.target, { redirect: "follow", signal: attempt.signal });
			const body = await readResponseBody(response);
			const evidence = sanitizeTerminalText(
				`HTTP ${String(response.status)} ${response.statusText}\n${body}`,
			).trimEnd();
			const condition = textCondition(evidence, this.input.successText, this.input.failureText);
			if (condition.state === "failed") return condition;
			if (!response.ok) return { evidence, state: "pending" };
			return condition;
		} finally {
			clearTimeout(timeout);
			this.controller.signal.removeEventListener("abort", parentAbort);
		}
	}

	private finish(status: BackgroundWorkOutcome["status"], summary: string): void {
		if (this.finalized) return;
		this.finalized = true;
		this.status = "stopping";
		this.controller.abort(status);
		this.outcomeResolve({
			endedAt: Date.now(),
			id: this.id,
			kind: "monitor",
			recentOutput: this.evidence,
			startedAt: this.startedAt,
			status,
			summary,
			title: this.title,
		});
	}
}

export async function startMonitor(
	runtime: BackgroundWorkRuntime,
	input: MonitorInput,
	ctx: ExtensionContext,
): Promise<StartedMonitor> {
	const timeoutSeconds = boundedSeconds(input.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS, "Monitor timeout", 86_400);
	const title = titleFor(input);
	if (!input.target.trim()) throw new Error("Monitor target is empty");
	if (input.source === "http") {
		const url = new URL(input.target);
		if (url.protocol !== "http:" && url.protocol !== "https:")
			throw new Error("Monitor HTTP target must use http or https");
	}
	if (input.source === "command") {
		const commandInput = {
			command: input.target,
			timeoutSeconds,
			toolCallId: input.toolCallId,
		};
		if (input.description) Object.assign(commandInput, { description: input.description });
		if (input.failureText) Object.assign(commandInput, { failureText: input.failureText });
		if (input.successText) Object.assign(commandInput, { successText: input.successText });
		const started = await runtime.startCommandMonitor(commandInput, ctx);
		const result: StartedMonitor = { id: started.id, title };
		if (started.outputPath) Object.assign(result, { outputPath: started.outputPath });
		return result;
	}
	const intervalSeconds = boundedSeconds(input.intervalSeconds, DEFAULT_INTERVAL_SECONDS, "Monitor interval", 60);
	const id = runtime.newMonitorId();
	const monitor = new PollingMonitor(
		id,
		input,
		Math.round(intervalSeconds * 1_000),
		Math.round(timeoutSeconds * 1_000),
	);
	runtime.registerMonitor(monitor);
	monitor.start();
	return { id, title };
}
