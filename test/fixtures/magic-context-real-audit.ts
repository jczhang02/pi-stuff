import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface AuditRecord {
	readonly [key: string]: unknown;
	readonly type: string;
}

function auditPath(): string {
	const path = process.env["PI_STUFF_MAGIC_REAL_AUDIT"]?.trim();
	if (!path) throw new Error("PI_STUFF_MAGIC_REAL_AUDIT is required");
	return path;
}

function write(record: AuditRecord): void {
	appendFileSync(auditPath(), `${JSON.stringify({ ...record, timestamp: Date.now() })}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
}

function contentCharacters(content: unknown): number {
	if (!Array.isArray(content)) return typeof content === "string" ? content.length : 0;
	return content.reduce((total, block) => {
		if (typeof block !== "object" || block === null) return total;
		const text = Reflect.get(block, "text");
		const thinking = Reflect.get(block, "thinking");
		return (
			total + (typeof text === "string" ? text.length : 0) + (typeof thinking === "string" ? thinking.length : 0)
		);
	}, 0);
}

/** Durable, content-free instrumentation used only by the maintainer's real-provider acceptance. */
export default function magicContextRealAudit(pi: ExtensionAPI): void {
	pi.on("session_start", (event, ctx) => {
		write({
			mode: ctx.mode,
			reason: event.reason,
			sessionId: ctx.sessionManager.getSessionId(),
			type: "session_start",
		});
	});

	pi.on("session_before_compact", (event) => {
		write({ reason: event.reason, type: "session_before_compact", willRetry: event.willRetry });
	});

	pi.on("session_compact", (event) => {
		write({
			fromExtension: event.fromExtension,
			reason: event.reason,
			type: "session_compact",
			willRetry: event.willRetry,
		});
	});

	pi.on("context", (event) => {
		write({
			characters: event.messages.reduce(
				(total, message) => total + contentCharacters(Reflect.get(message, "content")),
				0,
			),
			messages: event.messages.length,
			type: "context_projection",
		});
	});

	pi.on("tool_result", (event) => {
		write({
			characters: contentCharacters(event.content),
			isError: event.isError,
			toolName: event.toolName,
			type: "tool_result",
		});
	});
}
