import { isKeyRelease, truncateToWidth } from "@earendil-works/pi-tui";
import {
	type CommandDialogComponent,
	type CommandDialogView,
	type CommandDialogViewContext,
	commandDialogHintLines,
	commandDialogNavigation,
	commandDialogPrimaryKey,
	commandDialogReadKeyHelp,
	commandDialogRows,
	commandDialogScrollOffset,
	fitCommandDialogRows,
	matchesCommandDialogCancel,
	matchesCommandDialogHelp,
	renderCommandDialogKeyHelp,
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
	private lastViewportRows = 1;
	private scroll = 0;
	private showKeyHelp = false;
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
		if (this.disposed || isKeyRelease(data)) return;
		if (this.showKeyHelp) {
			if (matchesCommandDialogCancel(data, this.context.keybindings)) {
				this.showKeyHelp = false;
				this.context.requestRender();
			}
			return;
		}
		if (matchesCommandDialogHelp(data)) {
			this.showKeyHelp = true;
			this.context.requestRender();
			return;
		}
		if (matchesCommandDialogCancel(data, this.context.keybindings)) {
			this.context.close();
			return;
		}
		const navigation = commandDialogNavigation(data, this.context.keybindings);
		if (!navigation) return;
		const page = this.lastViewportRows;
		this.scroll = commandDialogScrollOffset(
			this.scroll,
			Math.max(0, (this.snapshot?.servers.length ?? 0) - page),
			page,
			navigation,
		);
		this.context.requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const renderWidth = Math.max(1, Math.floor(width));
		if (this.showKeyHelp) {
			return renderCommandDialogKeyHelp(
				this.context,
				renderWidth,
				"MCP",
				commandDialogReadKeyHelp(this.context.keybindings, "server", [
					{ keys: ".mcp.json", description: "Configure servers" },
				]),
			);
		}
		const maximumRows = commandDialogRows(this.context);
		if (maximumRows === 0) return [];
		const servers = this.snapshot?.servers ?? [];
		const emptyLines = [
			`${GUTTER}${this.context.theme.fg("muted", "No MCP servers configured.")}`,
			`${GUTTER}${this.context.theme.fg("dim", "Add .mcp.json, then run /reload.")}`,
		];
		const up = commandDialogPrimaryKey(this.context.keybindings, "tui.select.up", "↑");
		const down = commandDialogPrimaryKey(this.context.keybindings, "tui.select.down", "↓");
		const pageUp = commandDialogPrimaryKey(this.context.keybindings, "tui.select.pageUp", "PgUp");
		const pageDown = commandDialogPrimaryKey(this.context.keybindings, "tui.select.pageDown", "PgDn");
		const cancel = commandDialogPrimaryKey(this.context.keybindings, "tui.select.cancel", "Esc");
		const footerFor = (overflow: boolean) =>
			commandDialogHintLines(this.context.theme, renderWidth, [
				...(overflow ? [`${up}/${down} scroll`, `${pageUp}/${pageDown} page`] : []),
				"configure in .mcp.json",
				"? keys",
				`${cancel} close`,
			]);
		let footer = footerFor(false);
		this.lastViewportRows = Math.max(1, maximumRows - 2 - footer.length);
		footer = footerFor(servers.length > this.lastViewportRows);
		this.lastViewportRows = Math.max(1, maximumRows - 2 - footer.length);
		this.clampScroll();
		const visible = servers.slice(this.scroll, this.scroll + this.lastViewportRows);
		const serverLines = visible.map((server) => serverLine(this.context, server));
		const body = servers.length === 0 ? emptyLines : serverLines;
		const priority =
			serverLines.find((line) => line.includes("failed") || line.includes("needs auth")) ??
			serverLines[0] ??
			emptyLines[0] ??
			"";
		const lines = fitCommandDialogRows(
			{
				header: [this.context.theme.fg("border", "━".repeat(renderWidth)), headerLine(this.context, this.snapshot)],
				body,
				footer,
				priority: [priority],
			},
			maximumRows,
		);
		return lines.map((line) => truncateToWidth(line, renderWidth, "…"));
	}

	private clampScroll(): void {
		const maximum = Math.max(0, (this.snapshot?.servers.length ?? 0) - this.lastViewportRows);
		this.scroll = Math.min(maximum, Math.max(0, this.scroll));
	}
}

export function createMcpStatusView(store: McpStatusStore): CommandDialogView<void> {
	return {
		priority: "normal",
		create: (context) => new McpStatusDialog(context, store),
	};
}
