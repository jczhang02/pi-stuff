import { AsyncLocalStorage } from "node:async_hooks";
import { readWebConfig as readStoredWebConfig, WebConfigError } from "../settings.ts";
import { reportWebDiagnostic } from "./diagnostics.ts";

type WebConfig = NonNullable<ReturnType<typeof readStoredWebConfig>>;

const operationConfig = new AsyncLocalStorage<WebConfig>();

/** Read one fail-open settings snapshot for the current Web operation. */
export function readWebConfig(): WebConfig {
	const snapshot = operationConfig.getStore();
	if (snapshot) return snapshot;
	try {
		return readStoredWebConfig() ?? {};
	} catch (error) {
		if (!(error instanceof WebConfigError)) throw error;
		reportWebDiagnostic("Web settings were invalid and built-in defaults are active", error.message, {
			key: "invalid-settings",
			notice: true,
			severity: "warning",
		});
		return {};
	}
}

export function withWebConfigSnapshot<Value>(operation: () => Value): Value {
	return operationConfig.run(readWebConfig(), operation);
}
