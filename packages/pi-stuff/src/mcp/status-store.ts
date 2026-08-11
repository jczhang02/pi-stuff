import { boundTerminalLine } from "../tool-display/index.js";
import type { McpServerRuntimeStatus, McpServerStatusSnapshot, McpStatusSnapshot } from "./runtime/index.js";

type Listener = (snapshot: McpStatusSnapshot | undefined) => void;

const STATUSES = new Set<McpServerRuntimeStatus>([
	"cached",
	"connected",
	"disabled",
	"failed",
	"needs-auth",
	"not-connected",
]);
const MAX_SERVERS = 500;
const MAX_SERVER_NAME = 200;

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function serverName(value: unknown): string {
	return boundTerminalLine(value, MAX_SERVER_NAME);
}

function serverSnapshot(value: unknown): McpServerStatusSnapshot | undefined {
	const candidate = record(value);
	if (!candidate) return undefined;
	const name = serverName(candidate["name"]);
	const status = candidate["status"];
	if (!name || typeof status !== "string" || !STATUSES.has(status as McpServerRuntimeStatus)) return undefined;
	const resources = candidate["resourceCount"];
	const failedAge = candidate["failedAgoSeconds"];
	return {
		disabled: candidate["disabled"] === true,
		name,
		...(typeof resources === "number" ? { resourceCount: count(resources) } : {}),
		...(typeof failedAge === "number" ? { failedAgoSeconds: count(failedAge) } : {}),
		status: status as McpServerRuntimeStatus,
		toolCount: count(candidate["toolCount"]),
	};
}

/** Accept only the versioned, bounded snapshot shape published by the fork. */
export function parseMcpStatusSnapshot(value: unknown): McpStatusSnapshot | undefined {
	const candidate = record(value);
	if (candidate?.["version"] !== 1 || !Array.isArray(candidate["servers"])) return undefined;
	const servers = candidate["servers"].slice(0, MAX_SERVERS).flatMap((server) => {
		const parsed = serverSnapshot(server);
		return parsed ? [parsed] : [];
	});
	return {
		connectedCount: count(candidate["connectedCount"]),
		disabledCount: count(candidate["disabledCount"]),
		servers,
		totalResources: count(candidate["totalResources"]),
		totalTools: count(candidate["totalTools"]),
		version: 1,
	};
}

export class McpStatusStore {
	private readonly listeners = new Set<Listener>();
	private value: McpStatusSnapshot | undefined;

	get(): McpStatusSnapshot | undefined {
		return this.value;
	}

	set(value: unknown): void {
		const snapshot = parseMcpStatusSnapshot(value);
		if (!snapshot) return;
		this.value = snapshot;
		for (const listener of this.listeners) listener(snapshot);
	}

	clear(): void {
		this.value = undefined;
		for (const listener of this.listeners) listener(undefined);
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
