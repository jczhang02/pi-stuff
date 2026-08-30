import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	SessionShutdownEvent,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { Effect, Exit } from "effect";
import { ensureUiSettingsCommand } from "../packages/pi-stuff/src/conversation-ui/index.js";
import {
	completeEffectFoundationInstallation,
	EffectFoundation,
	installEffectFoundation,
} from "../packages/pi-stuff/src/shared/effect-foundation.js";
import piStuffTools, { getToolUiRuntime } from "../packages/pi-stuff/src/tool-display/index.js";
import { captureExtensionHandlers, createExtensionApi } from "./fixtures/extension-api.js";
import { createExtensionContext } from "./fixtures/extension-context.js";

type ExtensionEventListener = Parameters<ExtensionAPI["events"]["on"]>[1];
type LifecycleEvent = SessionShutdownEvent | SessionStartEvent;
type LifecycleHandler = (event: LifecycleEvent, context: ExtensionContext) => Promise<void> | void;

class HostEventBus {
	private readonly discovery = new Map<string, Set<ExtensionEventListener>>();
	private readonly lifecycle = new Map<string, LifecycleHandler[]>();

	facade(): ExtensionAPI {
		const discovery = this.discovery;
		const events: ExtensionAPI["events"] = {
			emit(name, value): void {
				for (const handler of discovery.get(name) ?? []) handler(value);
			},
			on(name, handler): () => void {
				const handlers = discovery.get(name) ?? new Set();
				handlers.add(handler);
				discovery.set(name, handlers);
				return () => handlers.delete(handler);
			},
		};
		return createExtensionApi({ events, on: captureExtensionHandlers(this.lifecycle) });
	}

	async fire(event: LifecycleEvent, context = createExtensionContext()): Promise<void> {
		for (const handler of this.lifecycle.get(event.type) ?? []) await handler(event, context);
	}

	handlerCount(type: LifecycleEvent["type"]): number {
		return this.lifecycle.get(type)?.length ?? 0;
	}
}

function contextWithPrompt(prompt: string): ExtensionContext {
	const entry: SessionEntry = {
		id: prompt,
		message: { content: prompt, role: "user", timestamp: 1 },
		parentId: null,
		timestamp: "2026-08-30T00:00:00.000Z",
		type: "message",
	};
	return createExtensionContext({ sessionManager: { getBranch: () => [entry] } });
}

test("one Host event bus shares a foundation and invalidates replaced Session work", async () => {
	const host = new HostEventBus();
	const first = installEffectFoundation(host.facade());
	const second = installEffectFoundation(host.facade());
	expect(second).toBe(first);

	await host.fire({ reason: "startup", type: "session_start" });
	const session = first.currentSession();
	expect(session).toBeDefined();
	if (!session) throw new Error("missing Session Scope");
	const capability = first.forkCapability();
	const operation = first.forkOperation(capability);

	const success = await first.run(operation, Effect.succeed("ok"));
	const failure = await first.run(operation, Effect.fail("expected"));
	const defect = await first.run(operation, Effect.die("defect"));
	expect(Exit.isSuccess(success) && success.value).toBe("ok");
	expect(Exit.hasFails(failure)).toBeTrue();
	expect(Exit.hasDies(defect)).toBeTrue();

	const running = first.run(operation, Effect.never);
	await Promise.resolve();
	await host.fire({ reason: "resume", type: "session_start" });
	expect(first.isCurrent(session)).toBeFalse();
	expect(first.currentSession()?.generation).toBe(session.generation + 1);
	expect(Exit.hasInterrupts(await running)).toBeTrue();

	await host.fire({ reason: "quit", type: "session_shutdown" });
});

test("one Host event bus shares and hands off Session-owned Tool UI resources", async () => {
	const host = new HostEventBus();
	const owner = host.facade();
	const duplicate = host.facade();
	const foundation = installEffectFoundation(owner);
	await piStuffTools(owner);
	const startHandlers = host.handlerCount("session_start");
	await piStuffTools(duplicate);

	expect(installEffectFoundation(duplicate)).toBe(foundation);
	const runtime = getToolUiRuntime(owner);
	expect(getToolUiRuntime(duplicate)).toBe(runtime);
	expect(host.handlerCount("session_start")).toBe(startHandlers);
	const settings = ensureUiSettingsCommand(owner);
	expect(settings.list().map(({ id }) => id)).toEqual([]);

	await host.fire({ reason: "startup", type: "session_start" });
	const first = settings.list()[0];
	expect(first?.id).toBe("toolRunningTimer");
	const projections: (readonly unknown[])[] = [];
	const resetProjection = runtime.resetProjection.bind(runtime);
	runtime.resetProjection = (messages) => {
		projections.push(messages);
		resetProjection(messages);
	};
	const release = Promise.withResolvers<void>();
	await foundation.run(
		foundation.forkOperation(),
		Effect.addFinalizer(() => Effect.promise(() => release.promise)),
	);
	const supersededContext = contextWithPrompt("superseded");
	const currentContext = contextWithPrompt("current");
	const supersededStart = host.fire({ reason: "resume", type: "session_start" }, supersededContext);
	await host.fire({ reason: "resume", type: "session_start" }, currentContext);
	release.resolve();
	await supersededStart;
	const replacement = settings.list()[0];
	expect(replacement?.id).toBe("toolRunningTimer");
	expect(replacement).not.toBe(first);
	const superseded = foundation.sessionFor(supersededContext.sessionManager);
	const current = foundation.sessionFor(currentContext.sessionManager);
	expect(superseded && foundation.isCurrent(superseded)).toBeFalse();
	expect(current && foundation.isCurrent(current)).toBeTrue();
	expect(projections.at(-1)?.[0]).toMatchObject({ content: "current", role: "user" });

	await host.fire({ reason: "quit", type: "session_shutdown" });
	expect(settings.list()).toEqual([]);
	await host.fire({ reason: "quit", type: "session_shutdown" });
	expect(settings.list()).toEqual([]);
});

test("the newest concurrent Session start remains current", async () => {
	const foundation = new EffectFoundation();
	await foundation.startSession();
	const release = Promise.withResolvers<void>();
	await foundation.run(
		foundation.forkOperation(),
		Effect.addFinalizer(() => Effect.promise(() => release.promise)),
	);

	const supersededStart = foundation.startSession();
	const newest = await foundation.startSession();
	expect(foundation.currentSession()).toBe(newest);
	expect(foundation.isCurrent(newest)).toBeTrue();

	release.resolve();
	const superseded = await supersededStart;
	expect(foundation.isCurrent(superseded)).toBeFalse();
	await foundation.shutdown();
});

test("owned Scope finalizers run once and Host shutdown stays bounded", async () => {
	const foundation = new EffectFoundation(5);
	await foundation.startSession();
	const capability = foundation.forkCapability();
	let releases = 0;
	const acquired = await foundation.run(
		capability,
		Effect.acquireRelease(Effect.succeed("resource"), () => Effect.sync(() => releases++)),
	);
	expect(Exit.isSuccess(acquired) && acquired.value).toBe("resource");
	expect(releases).toBe(0);
	expect(await foundation.close(capability)).toBeTrue();
	expect(await foundation.close(capability)).toBeTrue();
	expect(releases).toBe(1);

	const operation = foundation.forkOperation();
	await foundation.run(
		operation,
		Effect.addFinalizer(() => Effect.never),
	);
	const shutdown = await Promise.race([foundation.shutdown(), Bun.sleep(250).then(() => "hung" as const)]);
	expect(shutdown).toBeFalse();
});

test("Suite shutdown lets Capability protocols finish before Scope finalizers", async () => {
	const host = new HostEventBus();
	const pi = host.facade();
	const foundation = installEffectFoundation(pi, { deferShutdown: true });
	const context = createExtensionContext();
	await host.fire({ reason: "startup", type: "session_start" }, context);
	const order: string[] = [];
	await foundation.run(
		foundation.forkCapability(),
		Effect.addFinalizer(() => Effect.sync(() => order.push("scope-finalizer"))),
	);
	pi.on("session_shutdown", () => {
		order.push("capability-protocol");
	});
	completeEffectFoundationInstallation(pi);

	await host.fire({ reason: "quit", type: "session_shutdown" }, context);
	expect(order).toEqual(["capability-protocol", "scope-finalizer"]);
});

test("one hung operation cannot block a sibling Capability release", async () => {
	const foundation = new EffectFoundation(5);
	await foundation.startSession();
	let releases = 0;
	await foundation.run(
		foundation.forkCapability(),
		Effect.acquireRelease(Effect.void, () => Effect.sync(() => releases++)),
	);
	await foundation.run(
		foundation.forkOperation(),
		Effect.addFinalizer(() => Effect.never),
	);

	await foundation.startSession();
	expect(releases).toBe(1);
	await foundation.shutdown();
});
