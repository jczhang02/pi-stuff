import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	hasDirectUserActivation,
	readAgentWorkOrigin,
	withAgentWorkOrigin,
	withDirectUserActivation,
} from "../../packages/pi-stuff/src/conversation-ui/agent-run-origin.js";
import {
	beginSuiteNativeCompactionPreflight,
	deliverSuiteAgentMessage,
	isSuiteNativeCompactionPreflight,
	registerSuiteAgentMessagePreparation,
	sendSuiteAgentMessage,
} from "../../packages/pi-stuff/src/conversation-ui/suite-agent-message.js";

function hostApis(sendMessage: ExtensionAPI["sendMessage"]): [ExtensionAPI, ExtensionAPI] {
	const listeners = new Map<string, Set<(value: unknown) => void>>();
	const facade = () => ({
		emit(name: string, value: unknown): void {
			for (const listener of listeners.get(name) ?? []) listener(value);
		},
		on(name: string, listener: (value: unknown) => void): () => void {
			const current = listeners.get(name) ?? new Set();
			current.add(listener);
			listeners.set(name, current);
			return () => current.delete(listener);
		},
	});
	return [
		{ events: facade(), sendMessage } as unknown as ExtensionAPI,
		{ events: facade(), sendMessage } as unknown as ExtensionAPI,
	];
}

test("Suite Agent message preparation crosses Pi event facades and awaits thenables", async () => {
	const order: string[] = [];
	const thenable = {
		// biome-ignore lint/suspicious/noThenProperty: this regression intentionally exercises a non-Promise thenable.
		then(resolve: () => void): void {
			queueMicrotask(() => {
				order.push("accepted");
				resolve();
			});
		},
	};
	const [owner, sender] = hostApis((() => {
		order.push("send");
		return thenable;
	}) as ExtensionAPI["sendMessage"]);
	const unregister = registerSuiteAgentMessagePreparation(owner, {
		prepare: async (origin) => {
			order.push(`prepare:${origin}`);
		},
		stage: () => {
			order.push("stage");
			return () => order.push("rollback");
		},
	});

	await sendSuiteAgentMessage(
		sender,
		{ customType: "test", content: "continue", display: false },
		{ triggerTurn: true },
		() => true,
		() => order.push("callback"),
	);

	expect(order).toEqual(["prepare:automatic", "stage", "send", "accepted", "callback"]);
	unregister();
});

test("direct activation authority stays separate from historical user attribution", async () => {
	const activations: string[] = [];
	const delivered: object[] = [];
	const [owner, sender] = hostApis(((message: object) => {
		delivered.push(message);
	}) as ExtensionAPI["sendMessage"]);
	registerSuiteAgentMessagePreparation(owner, {
		prepare: async (activation) => {
			activations.push(activation);
		},
	});

	const historicalUserWork = withAgentWorkOrigin(
		{ customType: "background-result", content: "done", display: true },
		"user",
	);
	await sendSuiteAgentMessage(sender, historicalUserWork, { triggerTurn: true });
	const directUserAction = withAgentWorkOrigin(
		withDirectUserActivation({ customType: "command", content: "run", display: true }),
		"user",
	);
	await sendSuiteAgentMessage(sender, directUserAction, { triggerTurn: true });

	expect(activations).toEqual(["automatic", "direct-user"]);
	expect(delivered.map((message) => readAgentWorkOrigin(message))).toEqual(["user", "user"]);
	expect(hasDirectUserActivation(directUserAction)).toBe(true);
	expect(JSON.stringify(directUserAction)).not.toContain("direct-user-activation");
});

test("Suite Agent message delivery rolls staged state back only when Host delivery fails", async () => {
	const order: string[] = [];
	const [owner, sender] = hostApis((() =>
		Promise.reject(new Error("delivery failed"))) as ExtensionAPI["sendMessage"]);
	registerSuiteAgentMessagePreparation(owner, {
		prepare: async () => {},
		stage: () => () => order.push("rollback"),
	});

	await expect(
		sendSuiteAgentMessage(sender, { customType: "test", content: "continue", display: false }, { triggerTurn: true }),
	).rejects.toThrow("delivery failed");
	expect(order).toEqual(["rollback"]);
});

test("Suite Agent message delivery rechecks session ownership after asynchronous preparation", async () => {
	let releasePreparation = (): void => {};
	const preparation = new Promise<void>((resolve) => {
		releasePreparation = resolve;
	});
	let current = true;
	let deliveries = 0;
	const [owner, sender] = hostApis((() => {
		deliveries += 1;
	}) as ExtensionAPI["sendMessage"]);
	registerSuiteAgentMessagePreparation(owner, {
		prepare: () => preparation,
	});

	const pending = sendSuiteAgentMessage(
		sender,
		{ customType: "test", content: "continue", display: false },
		{ triggerTurn: true },
		() => current,
	);
	current = false;
	releasePreparation();

	await expect(pending).resolves.toBe(false);
	expect(deliveries).toBe(0);
});

test("Suite Agent message delivery cannot accept into a session replaced during Host delivery", async () => {
	let finishDelivery = (): void => {};
	const delivery = new Promise<void>((resolve) => {
		finishDelivery = resolve;
	});
	let current = true;
	let accepted = 0;
	const [, sender] = hostApis((() => delivery) as ExtensionAPI["sendMessage"]);

	const pending = deliverSuiteAgentMessage(
		sender,
		{ customType: "test", content: "continue", display: false },
		{ triggerTurn: true },
		() => current,
		() => {
			accepted += 1;
		},
	);
	current = false;
	finishDelivery();

	await expect(pending).resolves.toBe("stale");
	expect(accepted).toBe(0);
});

test("Suite Agent messages fail open through a partial standalone API without an event bus", async () => {
	let delivered = false;
	const api = {
		sendMessage: () => {
			delivered = true;
		},
	} as unknown as ExtensionAPI;

	await sendSuiteAgentMessage(api, { customType: "test", content: "continue", display: false });
	expect(delivered).toBe(true);
});

test("native custom-turn preflight markers are reference-counted by session", () => {
	const ctx = { sessionManager: {} } as Pick<ExtensionContext, "sessionManager">;
	const finishFirst = beginSuiteNativeCompactionPreflight(ctx);
	const finishSecond = beginSuiteNativeCompactionPreflight(ctx);
	expect(isSuiteNativeCompactionPreflight(ctx)).toBe(true);
	finishFirst();
	expect(isSuiteNativeCompactionPreflight(ctx)).toBe(true);
	finishFirst();
	finishSecond();
	expect(isSuiteNativeCompactionPreflight(ctx)).toBe(false);
});

test("convergence-blocked automatic turns are persisted without starting another model turn", async () => {
	const deliveries: Array<{ triggerTurn?: boolean }> = [];
	const [owner, sender] = hostApis(((_message, options) => {
		deliveries.push(options ?? {});
	}) as ExtensionAPI["sendMessage"]);
	let staged = false;
	let accepted = 0;
	registerSuiteAgentMessagePreparation(owner, {
		prepare: async () => ({
			status: "convergence-blocked",
			reason: "aggregate hard boundary reached",
		}),
		stage: () => {
			staged = true;
			return undefined;
		},
	});

	const result = await deliverSuiteAgentMessage(
		sender,
		{ customType: "fixture", content: "continue", display: false },
		{ triggerTurn: true },
		() => true,
		() => {
			accepted += 1;
		},
	);

	expect(result).toBe("convergence-blocked");
	expect(deliveries).toEqual([{ triggerTurn: false }]);
	expect(staged).toBe(false);
	expect(accepted).toBe(0);
	expect(
		await sendSuiteAgentMessage(
			sender,
			{ customType: "fixture", content: "continue", display: false },
			{ triggerTurn: true },
		),
	).toBe(true);
});
