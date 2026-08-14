import { describe, expect, test } from "bun:test";
import { parseChildProtocolEvent } from "../../packages/pi-stuff/src/subagents/src/runs/shared/child-protocol.js";

describe("child Agent event protocol", () => {
	test("rejects empty and unsupported event envelopes", () => {
		expect(parseChildProtocolEvent({})).toEqual({
			error: "event.type must be a non-empty string",
		});
		expect(parseChildProtocolEvent({ type: "future_unknown_event" })).toEqual({
			error: "event.type 'future_unknown_event' is unsupported",
		});
	});

	test("accepts Pi session headers and lifecycle events", () => {
		expect(
			parseChildProtocolEvent({
				type: "session",
				version: 3,
				id: "child-session",
				timestamp: "2026-08-13T00:00:00.000Z",
				cwd: "/workspace",
			}).error,
		).toBeUndefined();
		expect(parseChildProtocolEvent({ type: "agent_settled" }).error).toBeUndefined();
	});

	test("accepts Pi CustomMessage message_end events", () => {
		const parsed = parseChildProtocolEvent({
			type: "message_end",
			message: {
				role: "custom",
				customType: "magic-context:ceiling-nudge",
				content: "Compress completed context now.",
				display: false,
				details: { source: "magic-context" },
				timestamp: 1,
			},
		});

		expect(parsed.error).toBeUndefined();
		expect(parsed.event?.message).toMatchObject({
			role: "custom",
			customType: "magic-context:ceiling-nudge",
		});
	});

	test("keeps unsupported AgentMessage roles fail-closed", () => {
		const parsed = parseChildProtocolEvent({
			type: "message_end",
			message: {
				role: "bashExecution",
				command: "pwd",
				output: "/tmp",
				timestamp: 1,
			},
		});

		expect(parsed.event).toBeUndefined();
		expect(parsed.error).toBe("message_end message.role is invalid");
	});

	test("rejects malformed CustomMessage envelopes", () => {
		const parsed = parseChildProtocolEvent({
			type: "message_end",
			message: {
				role: "custom",
				customType: "magic-context:ceiling-nudge",
				content: "Compress completed context now.",
				display: false,
				timestamp: "not-a-timestamp",
			},
		});

		expect(parsed.event).toBeUndefined();
		expect(parsed.error).toBe("message_end message.timestamp must be a finite number");

		expect(
			parseChildProtocolEvent({
				type: "message_end",
				message: {
					role: "custom",
					customType: "magic-context:ceiling-nudge",
					content: "Compress completed context now.",
					display: false,
					timestamp: 1,
					model: 42,
				},
			}),
		).toEqual({ error: "message_end message.model must be a string" });
	});
});
