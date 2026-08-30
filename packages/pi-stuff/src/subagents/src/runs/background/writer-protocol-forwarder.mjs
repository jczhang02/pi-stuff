/** Bounded, backpressured projection from one Pi writer stream to its runner. */

import { Effect, Stream } from "effect";
import { Guard } from "typebox/guard";

const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES_ENV = "PI_SUBAGENT_CHILD_PROTOCOL_MAX_BYTES";
const MAX_PROTOCOL_LINE_BYTES = 16 * 1024 * 1024;

export const POST_EXIT_OUTPUT_IDLE_MS = 2_000;
export const POST_EXIT_OUTPUT_HARD_MS = 8_000;

function maxOutputBytes() {
	const parsed = Number(process.env[MAX_OUTPUT_BYTES_ENV]);
	return Number.isFinite(parsed) && parsed >= 1
		? Math.min(Math.floor(parsed), Number.MAX_SAFE_INTEGER - 1)
		: DEFAULT_MAX_OUTPUT_BYTES;
}

function projectProtocolLine(line) {
	let event;
	try {
		event = JSON.parse(line.toString("utf8"));
	} catch {
		return line;
	}
	if (!event || !Guard.IsObject(event) || Array.isArray(event) || !Guard.IsString(event.type)) return line;
	if (event.type === "message_start" || event.type === "message_update" || event.type === "turn_end") {
		return Buffer.from(JSON.stringify({ type: event.type }));
	}
	if (event.type === "agent_end") {
		const projected = { type: event.type };
		if (event.willRetry === true) projected.willRetry = true;
		return Buffer.from(JSON.stringify(projected));
	}
	if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
		const projected = { type: event.type };
		if (Guard.IsString(event.toolCallId)) projected.toolCallId = event.toolCallId;
		if (Guard.IsString(event.toolName)) projected.toolName = event.toolName;
		if (Guard.IsBoolean(event.isError)) projected.isError = event.isError;
		return Buffer.from(JSON.stringify(projected));
	}
	return line;
}

export function createBoundedPipeForwarder(
	source,
	destination,
	onLimit,
	projectProtocol = false,
	onActivity = () => {},
) {
	const limitBytes = maxOutputBytes();
	const lineLimitBytes = Math.min(MAX_PROTOCOL_LINE_BYTES, limitBytes);
	let observedBytes = 0;
	let forwardedBytes = 0;
	let limitReported = false;
	let lastReadAt = Date.now();
	let closedBySupervisor = false;
	let pending = [];
	let pendingBytes = 0;
	const write = (chunk) =>
		Effect.callback((resume) => {
			destination.write(chunk, (error) => resume(error ? Effect.fail(error) : Effect.void));
		});
	const forward = (chunk) => {
		observedBytes += chunk.length;
		if (observedBytes > limitBytes && !limitReported) {
			limitReported = true;
			onLimit(observedBytes);
		}
		// Forward one byte beyond the configured bound so the runner's protocol
		// authority sees overflow, then keep draining without unbounded buffering.
		const remaining = Math.max(0, limitBytes + 1 - forwardedBytes);
		if (remaining === 0) return Effect.void;
		const forwarded = chunk.subarray(0, Math.min(chunk.length, remaining));
		forwardedBytes += forwarded.length;
		return write(forwarded);
	};
	const flushLine = (terminated) => {
		const line = pendingBytes > 0 ? Buffer.concat(pending, pendingBytes) : Buffer.alloc(0);
		pending = [];
		pendingBytes = 0;
		const projected = projectProtocolLine(line);
		return forward(terminated ? Buffer.concat([projected, Buffer.from("\n")], projected.length + 1) : projected);
	};
	const append = (segment) =>
		Effect.gen(function* () {
			if (segment.length === 0) return true;
			const nextBytes = pendingBytes + segment.length;
			if (nextBytes <= lineLimitBytes) {
				pending.push(segment);
				pendingBytes = nextBytes;
				return true;
			}
			const accepted = Math.max(0, lineLimitBytes + 1 - pendingBytes);
			if (accepted > 0) {
				pending.push(segment.subarray(0, accepted));
				pendingBytes += accepted;
			}
			limitReported = true;
			onLimit(nextBytes);
			yield* forward(Buffer.concat(pending, pendingBytes));
			pending = [];
			pendingBytes = 0;
			return false;
		});
	const consume = (value) =>
		Effect.gen(function* () {
			lastReadAt = Date.now();
			onActivity();
			const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
			if (!projectProtocol) {
				yield* forward(chunk);
				return;
			}
			if (limitReported) return;
			let start = 0;
			for (let index = 0; index < chunk.length; index++) {
				if (chunk[index] !== 0x0a) continue;
				if (!(yield* append(chunk.subarray(start, index)))) return;
				yield* flushLine(true);
				start = index + 1;
			}
			if (!limitReported) yield* append(chunk.subarray(start));
		});
	const run = Stream.runForEach(
		Stream.fromAsyncIterable(source, (error) => error),
		consume,
	).pipe(
		Effect.andThen(
			Effect.suspend(() => (projectProtocol && !limitReported && pendingBytes > 0 ? flushLine(false) : Effect.void)),
		),
		Effect.catch((error) => (closedBySupervisor ? Effect.void : Effect.fail(error))),
	);
	return {
		close() {
			closedBySupervisor = true;
			try {
				source.destroy();
			} catch {
				// The read side may already be terminal.
			}
		},
		run,
		lastReadAt: () => lastReadAt,
	};
}
