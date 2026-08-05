import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { McpServerStatusSnapshot, McpStatusSnapshot } from "@jczhang02/pi-mcp-adapter";
import {
	type CommandDialogComponent,
	type CommandDialogView,
	type CommandDialogViewContext,
	commandDialogRows,
	fitCommandDialogRows,
} from "@jczhang02/pi-stuff-ui";
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
	const active = server.status === "connected";
	const failed = server.status === "failed" || server.status === "needs-auth";
	const marker = active ? theme.fg("success", "●") : failed ? theme.fg("error", "●") : theme.fg("dim", "○");
	const name = theme.fg(active ? "text" : "muted", server.name);
	const status = failed ? theme.fg("error", statusLabel(server)) : theme.fg("muted", statusLabel(server));
	const tools = server.disabled ? "" : theme.fg("dim", ` · ${String(server.toolCount)} tools`);
	return `${GUTTER}${marker} ${name} ${theme.fg("dim", "·")} ${status}${tools}`;
}

function headerLine(context: CommandDialogViewContext, snapshot: McpStatusSnapshot | undefined): string {
	if (!snapshot) return `${GUTTER}${context.theme.bold("MCP")} ${context.theme.fg("muted", "· initializing")}`;
	const enabled = Math.max(0, snapshot.servers.length - snapshot.disabledCount);
	return `${GUTTER}${context.theme.bold("MCP")} ${context.theme.fg(
		"muted",
		`· ${String(snapshot.connectedCount)}/${String(enabled)} connected · ${String(snapshot.totalTools)} tools`,
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
		else if (matchesKey(data, "pageUp")) this.scroll = Math.max(0, this.scroll - page);
		else if (matchesKey(data, "pageDown")) this.scroll += page;
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
		const emptyLine = `${GUTTER}${this.context.theme.fg("muted", "No MCP servers · add .mcp.json, then /reload")}`;
		const serverLines = visible.map((server) => serverLine(this.context, server));
		const body = servers.length === 0 ? [emptyLine] : serverLines;
		const footer = `${GUTTER}${this.context.theme.fg(
			"dim",
			servers.length > viewportRows
				? "↑↓ scroll · Esc close · configure in .mcp.json"
				: "Esc close · configure in .mcp.json",
		)}`;
		const priority =
			serverLines.find((line) => line.includes("failed") || line.includes("needs auth")) ??
			serverLines[0] ??
			emptyLine;
		const lines = fitCommandDialogRows(
			{
				header: [this.context.theme.fg("border", "─".repeat(renderWidth)), headerLine(this.context, this.snapshot)],
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
