import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
	type CommandDialogComponent,
	type CommandDialogView,
	type CommandDialogViewContext,
	commandDialogRows,
	fitCommandDialogRows,
	matchesCommandDialogPageDown,
	matchesCommandDialogPageUp,
} from "../conversation-ui/index.js";
import type { McpServerStatusSnapshot, McpStatusSnapshot } from "./runtime/index.js";
import type { McpStatusStore } from "./status-store.js";

const GUTTER = "  ";

function statusLabel(server: McpServerStatusSnapshot): string {
	switch (server.status) {
		case "connected":
			return "connected";
		case "cached":
			return "cached";
		case "failed":
			return server.failedAgoSeconds === undefined ? "failed" : `failed ${String(server.failedAgoSeconds)}s ago`;
		case "needs-auth":
			return "needs auth";
		case "disabled":
			return "disabled";
		case "not-connected":
			return "not connected";
	}
}

function serverLine(context: CommandDialogViewContext, server: McpServerStatusSnapshot): string {
	const { theme } = context;
	const marker =
		server.status === "connected"
			? theme.fg("success", "✓")
			: server.status === "failed"
				? theme.fg("error", "×")
				: server.status === "needs-auth"
					? theme.fg("warning", "!")
					: server.status === "disabled"
						? theme.fg("dim", "■")
						: theme.fg("muted", "○");
	const statusColor =
		server.status === "failed"
			? "error"
			: server.status === "needs-auth"
				? "warning"
				: server.status === "connected"
					? "success"
					: "muted";
	const action =
		server.status === "needs-auth"
			? `run /mcp-auth ${server.name}`
			: server.status === "failed"
				? `run /mcp reconnect ${server.name}`
				: "";
	const capabilities = [
		...(server.toolCount > 0 ? [`${String(server.toolCount)} ${server.toolCount === 1 ? "tool" : "tools"}`] : []),
		...(server.resourceCount && server.resourceCount > 0
			? [`${String(server.resourceCount)} ${server.resourceCount === 1 ? "resource" : "resources"}`]
			: []),
	].join(" · ");
	const suffix = action || capabilities;
	return `${GUTTER}${marker} ${theme.fg("text", server.name)} ${theme.fg("dim", "·")} ${theme.fg(
		statusColor,
		statusLabel(server),
	)}${suffix ? theme.fg(action ? "warning" : "dim", `  ${suffix}`) : ""}`;
}

function headerLine(context: CommandDialogViewContext, snapshot: McpStatusSnapshot | undefined): string {
	if (!snapshot) return `${GUTTER}${context.theme.bold("MCP")} ${context.theme.fg("accent", "· ● initializing")}`;
	const enabled = Math.max(0, snapshot.servers.length - snapshot.disabledCount);
	const tools = `${String(snapshot.totalTools)} ${snapshot.totalTools === 1 ? "tool" : "tools"}`;
	const resources =
		snapshot.totalResources > 0
			? ` · ${String(snapshot.totalResources)} ${snapshot.totalResources === 1 ? "resource" : "resources"}`
			: "";
	return `${GUTTER}${context.theme.bold("MCP")} ${context.theme.fg(
		"muted",
		`· ${String(snapshot.connectedCount)}/${String(enabled)} connected · ${tools}${resources}`,
	)}`;
}

class McpStatusDialog implements CommandDialogComponent {
	private readonly context: CommandDialogViewContext<void>;
	private disposed = false;
	private scroll = 0;
	private snapshot: McpStatusSnapshot | undefined;
	private readonly unsubscribe: () => void;

	constructor(context: CommandDialogViewContext<void>, store: McpStatusStore) {
		this.context = context;
		this.snapshot = store.get();
		this.unsubscribe = store.subscribe((snapshot) => {
			if (this.disposed) return;
			this.snapshot = snapshot;
			this.clampScroll();
			this.context.requestRender();
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribe();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
			this.context.close();
			return;
		}
		const page = this.viewportRows();
		if (matchesKey(data, Key.up)) this.scroll = Math.max(0, this.scroll - 1);
		else if (matchesKey(data, Key.down)) this.scroll += 1;
		else if (matchesCommandDialogPageUp(data)) this.scroll = Math.max(0, this.scroll - page);
		else if (matchesCommandDialogPageDown(data)) this.scroll += page;
		else return;
		this.clampScroll();
		this.context.requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.floor(width));
		const maximumRows = commandDialogRows(this.context);
		if (maximumRows === 0) return [];
		const servers = this.snapshot?.servers ?? [];
		const viewportRows = this.viewportRows();
		const visible = servers.slice(this.scroll, this.scroll + viewportRows);
		const emptyLines = [
			`${GUTTER}${this.context.theme.fg("muted", "No MCP servers configured.")}`,
			`${GUTTER}${this.context.theme.fg("dim", "Add .mcp.json, then run /reload.")}`,
		];
		const serverLines = visible.map((server) => serverLine(this.context, server));
		const body = servers.length === 0 ? emptyLines : serverLines;
		const footer = `${GUTTER}${this.context.theme.fg(
			"dim",
			servers.length > viewportRows
				? "Esc close · ↑/↓ scroll · Shift+↑/↓ page · configure in .mcp.json"
				: "Esc close · configure in .mcp.json",
		)}`;
		const priority =
			serverLines.find((line) => line.includes("failed") || line.includes("needs auth")) ??
			serverLines[0] ??
			emptyLines[0] ??
			"";
		const lines = fitCommandDialogRows(
			{
				header: [this.context.theme.fg("border", "━".repeat(renderWidth)), headerLine(this.context, this.snapshot)],
				body,
				footer: [footer],
				priority: [priority],
			},
			maximumRows,
		);
		return lines.map((line) => truncateToWidth(line, renderWidth, "…"));
	}

	private clampScroll(): void {
		const maximum = Math.max(0, (this.snapshot?.servers.length ?? 0) - this.viewportRows());
		this.scroll = Math.min(maximum, Math.max(0, this.scroll));
	}

	private viewportRows(): number {
		return Math.max(1, commandDialogRows(this.context) - 3);
	}
}

export function createMcpStatusView(store: McpStatusStore): CommandDialogView<void> {
	return {
		priority: "normal",
		create: (context) => new McpStatusDialog(context, store),
	};
}
