import type { JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeFunction, isRuntimeObject } from "../../shared/runtime-type.js";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { HOST_SHUTDOWN_GRACE_MS, settleWithin } from "../../lifecycle-deadline.js";
import { readHostProxyProperty } from "../../shared/host-proxy.js";
import { logger } from "./logger.ts";
import { formatTerminalError } from "./utils.ts";

export interface McpRuntimeOwner {
  readonly signal: AbortSignal;
  isActive(): boolean;
  addCleanup(cleanup: () => void | Promise<void>): void;
  stop(reason?: string): Promise<void>;
  throwIfInactive(): void;
}

export function createMcpRuntimeOwner(shutdownGraceMs = HOST_SHUTDOWN_GRACE_MS): McpRuntimeOwner {
  const controller = new AbortController();
  const cleanups: Array<() => void | Promise<void>> = [];
  let stopPromise: Promise<void> | undefined;

  const reportCleanupFailure = (error: JsonInputValue, late: boolean) => {
    logger.error(
      `MCP: ${late ? "late " : ""}runtime cleanup failed`,
      error instanceof Error ? error : new Error(formatTerminalError(error)),
    );
  };

  return {
    signal: controller.signal,
    isActive: () => !controller.signal.aborted,
    addCleanup: cleanup => {
      if (controller.signal.aborted) {
        void Promise.resolve().then(cleanup).catch(error => reportCleanupFailure(error, true));
        return;
      }
      cleanups.push(cleanup);
    },
    stop: (reason = "MCP extension runtime stopped") => {
      if (stopPromise) return stopPromise;
      controller.abort(new Error(reason));
      const pendingCleanups = cleanups.splice(0).reverse().map(cleanup =>
        Promise.resolve().then(cleanup),
      );
      const cleanup = Promise.allSettled(pendingCleanups).then(results => {
        const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
        if (failures.length > 0) {
          const aggregate = new AggregateError(failures, "MCP runtime cleanup failed");
          logger.error("MCP: runtime cleanup failed", aggregate);
          throw aggregate;
        }
      });
      stopPromise = settleWithin(cleanup, shutdownGraceMs).then(() => undefined);
      return stopPromise;
    },
    throwIfInactive: () => controller.signal.throwIfAborted(),
  };
}

export function combineAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

/** Fence session-bound UI calls after the owning extension runtime stops. */
export function createOwnedUi(ui: ExtensionUIContext, owner: McpRuntimeOwner): ExtensionUIContext {
  const proxies = new WeakMap<object, object>();
  const wrap = <Value extends object>(value: Value): Value => {
    const existing = proxies.get(value);
    if (existing) {
      // SAFETY: this cache stores only transparent proxies created for the exact same source object.
      return existing as Value;
    }

    const proxy = new Proxy(value, {
      get(target, property, receiver) {
        if (!owner.isActive()) return undefined;
        const member = readHostProxyProperty(target, property, receiver);
        if (isRuntimeFunction(member)) {
          return (...args: JsonInputValue[]) => {
            if (!owner.isActive()) return undefined;
            return member.apply(target, args);
          };
        }
        if (member !== null && isRuntimeObject(member)) {
          return owner.isActive() ? wrap(member) : undefined;
        }
        return owner.isActive() ? member : undefined;
      },
    });
    proxies.set(value, proxy);
    return proxy;
  };
  return wrap(ui);
}

export function isAbortError(error: JsonInputValue, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && (error.name === "AbortError" || error.message === "MCP extension runtime stopped");
}
