import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { Effect, Exit } from "effect";
import { EffectFoundation, installEffectFoundation } from "../packages/pi-stuff/src/shared/effect-foundation.js";
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

	async fire(event: LifecycleEvent): Promise<void> {
		for (const handler of this.lifecycle.get(event.type) ?? []) await handler(event, createExtensionContext());
	}
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
