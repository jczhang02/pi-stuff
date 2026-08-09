/**
 * PROTOTYPE — throwaway reference translation, not product code.
 *
 * Question: Can the observable Claude Code 2.1.197 `/agents` interaction
 * translate into a native certified-Pi editor-replacement surface without an
 * HTML terminal imitation or an experimental overlay?
 *
 * Run from the repository root:
 * node_modules/.bin/pi --no-session --no-extensions \
 *   -e ./docs/prototypes/tui/agents-hub-reference.ts \
 *   --no-skills --no-prompt-templates --no-context-files \
 *   --no-tools --no-themes --offline --approve
 *
 * Then enter `/prototype-agents`.
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

type HubTab = "running" | "library";
type HubView = "hub" | "create-scope" | "agent-menu";
type HubFocus = "tabs" | "list";

interface AgentDefinition {
	name: string;
	model: string;
	scope: "project" | "built-in";
}

const CODE_REVIEWER: AgentDefinition = {
	name: "code-reviewer",
	model: "sonnet",
	scope: "project",
};

const AGENTS: AgentDefinition[] = [
	CODE_REVIEWER,
	{ name: "docs-researcher", model: "haiku", scope: "project" },
	{ name: "test-runner", model: "haiku", scope: "project" },
	{ name: "claude", model: "inherit", scope: "built-in" },
	{ name: "Explore", model: "haiku", scope: "built-in" },
	{ name: "general-purpose", model: "inherit", scope: "built-in" },
	{ name: "Plan", model: "inherit", scope: "built-in" },
];

const AGENT_MENU_ACTIONS = ["Run agent", "View agent", "Edit agent", "Delete agent", "Back"];
const CREATE_SCOPES = ["Project  (.claude/agents/)", "Personal  (~/.claude/agents/)"];

export default function registerAgentsHubReference(pi: ExtensionAPI): void {
	pi.registerCommand("prototype-agents", {
		description: "Open the throwaway native-TUI Agents Hub reference",
		handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/prototype-agents requires interactive mode", "error");
				return;
			}

			await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				return new AgentsHubReference(theme, () => tui.requestRender(), done);
			});
		},
	});
}

class AgentsHubReference implements Component {
	private tab: HubTab = "running";
	private view: HubView = "hub";
	private focus: HubFocus = "tabs";
	private selectedLibraryItem = 0;
	private selectedMenuItem = 0;
	private selectedScope = 0;
	private selectedAgent = CODE_REVIEWER;

	constructor(
		private readonly theme: Theme,
		private readonly requestRender: () => void,
		private readonly done: () => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			if (this.view === "hub") {
				this.done();
				return;
			}

			this.view = "hub";
			this.tab = "library";
			this.focus = "list";
			this.requestRender();
			return;
		}

		if (this.view === "create-scope") {
			this.handleCreateScopeInput(data);
			return;
		}

		if (this.view === "agent-menu") {
			this.handleAgentMenuInput(data);
			return;
		}

		if (matchesKey(data, "left") || matchesKey(data, "right")) {
			this.tab = this.tab === "running" ? "library" : "running";
			this.focus = "tabs";
			this.requestRender();
			return;
		}

		if (this.tab !== "library") return;

		if (matchesKey(data, "down")) {
			if (this.focus === "tabs") {
				this.focus = "list";
			} else {
				this.selectedLibraryItem = Math.min(AGENTS.length, this.selectedLibraryItem + 1);
			}
			this.requestRender();
			return;
		}

		if (matchesKey(data, "up")) {
			if (this.focus === "list" && this.selectedLibraryItem === 0) {
				this.focus = "tabs";
			} else if (this.focus === "list") {
				this.selectedLibraryItem = Math.max(0, this.selectedLibraryItem - 1);
			}
			this.requestRender();
			return;
		}

		if (matchesKey(data, "return") && this.focus === "list") {
			if (this.selectedLibraryItem === 0) {
				this.view = "create-scope";
				this.selectedScope = 0;
			} else {
				const selectedAgent = AGENTS[this.selectedLibraryItem - 1];
				if (!selectedAgent) return;
				this.selectedAgent = selectedAgent;
				this.view = "agent-menu";
				this.selectedMenuItem = 0;
			}
			this.requestRender();
		}
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		const lines =
			this.view === "hub"
				? this.renderHub(renderWidth)
				: this.view === "create-scope"
					? this.renderCreateScope(renderWidth)
					: this.renderAgentMenu(renderWidth);

		return lines.map((line) => truncateToWidth(line, renderWidth));
	}

	private handleCreateScopeInput(data: string): void {
		if (matchesKey(data, "up")) {
			this.selectedScope = Math.max(0, this.selectedScope - 1);
			this.requestRender();
			return;
		}

		if (matchesKey(data, "down")) {
			this.selectedScope = Math.min(CREATE_SCOPES.length - 1, this.selectedScope + 1);
			this.requestRender();
		}
	}

	private handleAgentMenuInput(data: string): void {
		if (matchesKey(data, "up")) {
			this.selectedMenuItem = Math.max(0, this.selectedMenuItem - 1);
			this.requestRender();
			return;
		}

		if (matchesKey(data, "down")) {
			this.selectedMenuItem = Math.min(AGENT_MENU_ACTIONS.length - 1, this.selectedMenuItem + 1);
			this.requestRender();
			return;
		}

		if (matchesKey(data, "return") && AGENT_MENU_ACTIONS[this.selectedMenuItem] === "Back") {
			this.view = "hub";
			this.requestRender();
		}
	}

	private renderHub(width: number): string[] {
		const runningTab = this.renderTab("Running", this.tab === "running");
		const libraryTab = this.renderTab("Library", this.tab === "library");
		const lines = [
			this.theme.fg("border", "─".repeat(width)),
			` ${this.theme.fg("muted", "Agents")}  ${runningTab}  ${libraryTab}`,
			"",
		];

		if (this.tab === "running") {
			lines.push("  No subagents are currently running.", "");
		} else {
			lines.push(...this.renderLibrary());
		}

		lines.push(this.theme.fg("dim", "  ←/→ switch · ↑/↓ navigate · Enter select · Esc close"));
		return lines;
	}

	private renderLibrary(): string[] {
		const lines = [this.renderSelectable("Create new agent", 0), ""];
		const projectAgents = AGENTS.filter((agent) => agent.scope === "project");
		const builtInAgents = AGENTS.filter((agent) => agent.scope === "built-in");

		lines.push(this.theme.fg("muted", "  Project agents  (./.claude/agents)"));
		for (const agent of projectAgents) {
			lines.push(this.renderAgent(agent));
		}

		lines.push("", this.theme.fg("muted", "  Built-in agents  (always available)"));
		for (const agent of builtInAgents) {
			lines.push(this.renderAgent(agent));
		}
		lines.push("");
		return lines;
	}

	private renderAgent(agent: AgentDefinition): string {
		const agentIndex = AGENTS.indexOf(agent) + 1;
		return this.renderSelectable(`${agent.name} · ${agent.model}`, agentIndex);
	}

	private renderSelectable(label: string, itemIndex: number): string {
		const selected = this.focus === "list" && this.selectedLibraryItem === itemIndex;
		const prefix = selected ? this.theme.fg("accent", "❯ ") : "  ";
		const text = selected ? this.theme.fg("text", label) : this.theme.fg("muted", label);
		return `${prefix}${text}`;
	}

	private renderTab(label: string, active: boolean): string {
		if (!active) return this.theme.fg("muted", label);
		const text = this.theme.bold(label);
		return this.focus === "tabs" ? this.theme.fg("accent", text) : this.theme.fg("text", text);
	}

	private renderCreateScope(width: number): string[] {
		const lines = [
			this.theme.fg("border", "─".repeat(width)),
			this.theme.fg("text", "  Create new agent"),
			this.theme.fg("muted", "  Choose location"),
			"",
		];

		for (let index = 0; index < CREATE_SCOPES.length; index += 1) {
			const selected = index === this.selectedScope;
			const prefix = selected ? this.theme.fg("accent", "❯ ") : "  ";
			lines.push(`${prefix}${index + 1}. ${CREATE_SCOPES[index]}`);
		}

		lines.push("", this.theme.fg("dim", "  ↑/↓ navigate · Enter select · Esc cancel"));
		return lines;
	}

	private renderAgentMenu(width: number): string[] {
		const lines = [
			this.theme.fg("border", "─".repeat(width)),
			this.theme.fg("text", `  ${this.selectedAgent.name}`),
			"",
		];

		for (let index = 0; index < AGENT_MENU_ACTIONS.length; index += 1) {
			const selected = index === this.selectedMenuItem;
			const prefix = selected ? this.theme.fg("accent", "❯ ") : "  ";
			lines.push(`${prefix}${index + 1}. ${AGENT_MENU_ACTIONS[index]}`);
		}

		lines.push("", this.theme.fg("dim", "  ↑/↓ navigate · Enter select · Esc back"));
		return lines;
	}
}
