import { describe, expect, test } from "bun:test";
import { createEventBus, type ExtensionAPI, initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import {
	hasDirectUserActivation,
	readAgentWorkOrigin,
} from "../../packages/pi-stuff/src/conversation-ui/agent-run-origin.js";
import type { SuiteAgentMessageHost } from "../../packages/pi-stuff/src/conversation-ui/suite-agent-message.js";
import { registerSuiteAgentMessagePreparation } from "../../packages/pi-stuff/src/conversation-ui/suite-agent-message.js";
import {
	dispatchMcpPromptToAgent,
	MCP_USER_PROMPT_MESSAGE_TYPE,
	registerMcpPromptMessageRenderer,
} from "../../packages/pi-stuff/src/mcp/runtime/prompts.js";
import {
	sendUserDrivenUiAgentMessage,
	type UiAgentMessageState,
} from "../../packages/pi-stuff/src/mcp/runtime/ui-session.js";

describe("MCP user-driven Agent attribution", () => {
	test("delivers an MCP prompt as a marked custom follow-up", async () => {
		type SendMessageArguments = Parameters<ExtensionAPI["sendMessage"]>;
		const delivered: Array<{ message: SendMessageArguments[0]; options: SendMessageArguments[1] }> = [];
		const pi: SuiteAgentMessageHost = {
			sendMessage: (message: SendMessageArguments[0], options?: SendMessageArguments[1]) => {
				delivered.push({ message, options });
			},
		};

		await dispatchMcpPromptToAgent(pi, "Review this MCP prompt");
		expect(delivered).toHaveLength(1);
		expect(delivered[0]?.options).toEqual({ deliverAs: "followUp", triggerTurn: true });
		expect(delivered[0]?.message).toMatchObject({
			content: "Review this MCP prompt",
			customType: MCP_USER_PROMPT_MESSAGE_TYPE,
			display: true,
		});
		expect(readAgentWorkOrigin(delivered[0]?.message as object)).toBe("user");
		expect(hasDirectUserActivation(delivered[0]?.message as object)).toBe(true);
	});

	test("drops an MCP prompt when its owner expires during Context preparation", async () => {
		let releasePreparation = (): void => {};
		const preparation = new Promise<void>((resolve) => {
			releasePreparation = resolve;
		});
		let deliveries = 0;
		let current = true;
		const pi: SuiteAgentMessageHost & Pick<ExtensionAPI, "events"> = {
			events: createEventBus(),
			sendMessage: () => {
				deliveries++;
			},
		};
		registerSuiteAgentMessagePreparation(pi, { prepare: () => preparation });

		const pending = dispatchMcpPromptToAgent(pi, "stale prompt", () => current);
		current = false;
		releasePreparation();

		expect(await pending).toBe(false);
		expect(deliveries).toBe(0);
	});

	test("renders the custom prompt with Pi's native user-message component", () => {
		initTheme("dark", false);
		let renderer: ((message: { content: string }, options: { outputPad: number }) => unknown) | undefined;
		const pi = {
			registerMessageRenderer: (_type: string, next: typeof renderer) => {
				renderer = next;
			},
		} as ExtensionAPI;

		registerMcpPromptMessageRenderer(pi);
		const component = renderer?.({ content: "Rendered MCP prompt" }, { outputPad: 1 });
		expect(component).toBeInstanceOf(UserMessageComponent);
		expect((component as UserMessageComponent).render(80).join("\n")).toContain("Rendered MCP prompt");
	});

	test("marks an MCP UI action only after its Agent message is accepted", () => {
		const order: string[] = [];
		const messages: unknown[] = [];
		const state = {
			owner: { isActive: () => true },
			isAgentIdle: () => false,
			sendMessage: (message: unknown, options: unknown) => {
				order.push("send");
				messages.push({ message, options });
			},
			promoteActiveAgentWorkToUser: () => order.push("promote"),
		} satisfies UiAgentMessageState;

		expect(
			sendUserDrivenUiAgentMessage(state, {
				customType: "mcp-ui-prompt",
				content: [{ type: "text", text: "Inspect this UI prompt" }],
			}),
		).toBe(true);
		expect(order).toEqual(["send", "promote"]);
		expect(messages).toHaveLength(1);
		const delivered = messages[0] as { message: { details?: unknown }; options: unknown };
		expect(readAgentWorkOrigin(delivered.message)).toBe("user");
		expect(delivered.options).toEqual({ deliverAs: "steer", triggerTurn: true });
	});

	test("lets the marked message attribute an idle MCP UI turn without a premature promotion", () => {
		let promotions = 0;
		let delivered: { details?: unknown } | undefined;
		const state = {
			owner: { isActive: () => true },
			isAgentIdle: () => true,
			sendMessage: (message: { details?: unknown }) => {
				delivered = message;
			},
			promoteActiveAgentWorkToUser: () => {
				promotions += 1;
			},
		} satisfies UiAgentMessageState;

		expect(
			sendUserDrivenUiAgentMessage(state, {
				customType: "mcp-ui-prompt",
				content: [{ type: "text", text: "Idle prompt" }],
			}),
		).toBe(true);
		expect(promotions).toBe(0);
		expect(readAgentWorkOrigin(delivered as object)).toBe("user");
	});

	test("promotes an active MCP UI action only after async Context preparation accepts it", async () => {
		const order: string[] = [];
		let accept!: (accepted: boolean) => void;
		const state = {
			owner: { isActive: () => true },
			isAgentIdle: () => false,
			sendMessage: () =>
				new Promise<boolean>((resolve) => {
					order.push("prepare");
					accept = resolve;
				}),
			promoteActiveAgentWorkToUser: () => order.push("promote"),
		} satisfies UiAgentMessageState;

		expect(
			sendUserDrivenUiAgentMessage(state, {
				customType: "mcp-ui-prompt",
				content: [{ type: "text", text: "Prepared prompt" }],
			}),
		).toBe(true);
		expect(order).toEqual(["prepare"]);
		accept(true);
		await Promise.resolve();
		expect(order).toEqual(["prepare", "promote"]);
	});
});
