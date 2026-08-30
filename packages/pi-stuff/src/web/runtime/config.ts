import { AsyncLocalStorage } from "node:async_hooks";
import type { SettingsRecord } from "../../shared/settings-io/index.ts";

const operationConfig = new AsyncLocalStorage<SettingsRecord>();

/** Read the immutable settings snapshot owned by the current Web operation. */
export function readWebConfig(): SettingsRecord {
	return operationConfig.getStore() ?? {};
}

export function withWebConfigSnapshot<Value>(settings: SettingsRecord, operation: () => Value): Value {
	return operationConfig.run(settings, operation);
}
