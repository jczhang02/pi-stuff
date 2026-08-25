import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { applyContextPromptContributions } from "../../packages/pi-stuff/src/context-management/prompt-contributions.js";
import ponytailCapability, {
	getPonytailMode,
	newestPonytailBranchMode,
} from "../../packages/pi-stuff/src/ponytail/index.js";
import { PONYTAIL_SESSION_ENTRY_TYPE } from "../../packages/pi-stuff/src/ponytail/types.js";
import { isJsonInputObject, type JsonInputValue } from "../../packages/pi-stuff/src/shared/json-value.js";
import { captureExtensionHandlers, createExtensionApi } from "../fixtures/extension-api.js";
import { createExtensionCommandContext } from "../fixtures/extension-context.js";

type HandlerResult = { readonly action: "continue" } | undefined;
type Handler = (event: JsonInputValue, ctx: ExtensionContext) => HandlerResult | Promise<HandlerResult>;
type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type EntryData = Parameters<ExtensionAPI["appendEntry"]>[1];
type SentContent = Parameters<ExtensionAPI["sendUserMessage"]>[0];
type SentMessageOptions = Parameters<ExtensionAPI["sendUserMessage"]>[1];
let sequence = 0;
const cleanups: Array<() => Promise<void>> = [];

function entry(mode: JsonInputValue): SessionEntry {
	// SAFETY: this fixture supplies the complete custom-entry shape consumed by newestPonytailBranchMode.
	return { type: "custom", customType: PONYTAIL_SESSION_ENTRY_TYPE, data: { mode } } as SessionEntry;
}

function harness(
	options: { entries?: SessionEntry[]; settings?: JsonInputValue; activeTools?: string[]; idle?: boolean } = {},
) {
	const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stuff-ponytail-runtime-"));
	if (options.settings !== undefined) {
		fs.writeFileSync(path.join(agentDir, "pi-stuff.json"), `${JSON.stringify(options.settings)}\n`);
	}
	const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
	process.env["PI_CODING_AGENT_DIR"] = agentDir;
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, Command>();
	const entries = [...(options.entries ?? [])];
	const appended: Array<{ customType: string; data: EntryData }> = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const statuses: Array<string | undefined> = [];
	const sent: Array<{ content: SentContent; options: SentMessageOptions }> = [];
	const host = createExtensionApi({
		on: captureExtensionHandlers(handlers),
		registerCommand(name, command) {
			commands.set(name, command);
		},
		appendEntry(customType, data) {
			appended.push({ customType, data });
			entries.push(entry(isJsonInputObject(data) ? data["mode"] : undefined));
		},
		getActiveTools: () => options.activeTools ?? ["read"],
		sendUserMessage(content, sendOptions) {
			sent.push({ content, options: sendOptions });
		},
	});
	const sessionId = `ponytail-runtime-${++sequence}`;
	const context = createExtensionCommandContext({
		isIdle: () => options.idle !== false,
		sessionManager: {
			getBranch: () => entries,
			getSessionFile: () => undefined,
			getSessionId: () => sessionId,
		},
		ui: {
			notify: (message, level) => notifications.push({ message, level: level ?? "info" }),
			setStatus: (_key, value) => statuses.push(value),
		},
	});
	ponytailCapability(host);
	const emit = async (name: string, event: JsonInputValue = {}) => {
		const results: HandlerResult[] = [];
		for (const handler of handlers.get(name) ?? []) results.push(await handler(event, context));
		return results.at(-1);
	};
	const cleanup = async () => {
		await emit("session_shutdown");
		if (previousAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
		fs.rmSync(agentDir, { force: true, recursive: true });
	};
	cleanups.push(cleanup);
	return { agentDir, appended, commands, ctx: context, emit, notifications, pi: host, sent, statuses };
}

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	delete process.env["PI_STUFF_PONYTAIL_MODE"];
	delete process.env["PONYTAIL_DEFAULT_MODE"];
	delete process.env["PONYTAIL_HIDE_STATUS"];
	delete process.env["PONYTAIL_QUIET_STARTUP"];
});

describe("Ponytail Session runtime", () => {
	test("restores the newest valid branch entry before inherited and configured modes", async () => {
		process.env["PI_STUFF_PONYTAIL_MODE"] = "ultra";
		const h = harness({
			entries: [entry("lite"), entry("review"), entry("off")],
			settings: { ponytail: { defaultMode: "full", hideStatus: false, quietStartup: false } },
		});
		await h.emit("session_start");
		expect(getPonytailMode(h.pi)).toBe("off");
		expect(h.statuses.at(-1)).toBeUndefined();
		expect(h.notifications).toHaveLength(0);
	});

	test("inherits explicit off and otherwise uses the configured default", async () => {
		process.env["PI_STUFF_PONYTAIL_MODE"] = "off";
		const inherited = harness();
		await inherited.emit("session_start");
		expect(getPonytailMode(inherited.pi)).toBe("off");
		delete process.env["PI_STUFF_PONYTAIL_MODE"];
		const configured = harness({
			settings: { ponytail: { defaultMode: "lite", hideStatus: false, quietStartup: true } },
		});
		await configured.emit("session_start");
		expect(getPonytailMode(configured.pi)).toBe("lite");
		expect(configured.statuses.at(-1)).toBe("♞ lite");
	});

	test("persists direct modes while review remains a Skill rather than a mode", async () => {
		const h = harness();
		await h.emit("session_start");
		const command = h.commands.get("ponytail");
		expect(command).toBeDefined();
		await command?.handler("ultra", h.ctx);
		expect(h.appended).toEqual([{ customType: PONYTAIL_SESSION_ENTRY_TYPE, data: { mode: "ultra" } }]);
		expect(h.statuses.at(-1)).toBe("♞ ultra");
		await command?.handler("review", h.ctx);
		expect(h.appended).toHaveLength(1);
		expect(h.notifications.at(-1)?.message).toContain("Usage:");
	});

	test("applies direct default, visibility, startup, and activation commands", async () => {
		const h = harness();
		await h.emit("session_start");
		const command = h.commands.get("ponytail");
		await command?.handler("default lite", h.ctx);
		await command?.handler("status hide", h.ctx);
		await command?.handler("startup quiet", h.ctx);
		await command?.handler("off", h.ctx);
		await command?.handler("on", h.ctx);

		expect(getPonytailMode(h.pi)).toBe("lite");
		expect(h.statuses.at(-1)).toBeUndefined();
		expect(JSON.parse(fs.readFileSync(path.join(h.agentDir, "pi-stuff.json"), "utf8"))).toEqual({
			ponytail: { defaultMode: "lite", hideStatus: true, quietStartup: true },
		});
	});

	test("keeps the five upstream command aliases and Skill delivery semantics", async () => {
		const idle = harness();
		await idle.emit("session_start");
		for (const name of ["ponytail-review", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help"]) {
			expect(idle.commands.has(name)).toBeTrue();
		}
		await idle.commands.get("ponytail-review")?.handler("focus auth", idle.ctx);
		expect(idle.sent).toEqual([
			{
				content: "/skill:ponytail-review focus auth",
				options: { expandPromptTemplates: true },
			},
		]);
		const streaming = harness({ idle: false });
		await streaming.emit("session_start");
		await streaming.commands.get("ponytail-audit")?.handler("", streaming.ctx);
		expect(streaming.sent[0]).toEqual({
			content: "/skill:ponytail-audit",
			options: { deliverAs: "followUp", expandPromptTemplates: true },
		});
	});

	test("recognizes only direct natural-language deactivation requests", async () => {
		const h = harness();
		await h.emit("session_start");
		await h.emit("input", { source: "interactive", text: "stop ponytail" });
		expect(getPonytailMode(h.pi)).toBe("off");
		await h.commands.get("ponytail")?.handler("full", h.ctx);
		await h.emit("input", { source: "extension", text: "normal mode" });
		expect(getPonytailMode(h.pi)).toBe("full");
		await h.emit("input", { source: "interactive", text: "please stop ponytail now" });
		expect(getPonytailMode(h.pi)).toBe("full");
	});

	test("deduplicates startup notification and prompt projection", async () => {
		const h = harness();
		await h.emit("session_start");
		await h.emit("session_start");
		expect(h.notifications.filter((item) => item.message.startsWith("Ponytail active"))).toHaveLength(1);
		const event: BeforeAgentStartEvent = {
			type: "before_agent_start",
			prompt: "work",
			systemPrompt: "Host\n\nMagic",
			systemPromptOptions: { cwd: "/workspace", skills: [] },
		};
		const projected = await applyContextPromptContributions(h.pi, event, h.ctx);
		expect(projected?.systemPrompt).toContain("PONYTAIL MODE ACTIVE — level: full");
		const repeated = await applyContextPromptContributions(
			h.pi,
			{ ...event, systemPrompt: projected?.systemPrompt ?? event.systemPrompt },
			h.ctx,
		);
		expect(repeated).toBeUndefined();
	});
});

test("newestPonytailBranchMode ignores invalid and non-Ponytail entries", () => {
	expect(newestPonytailBranchMode([entry("lite"), entry("review"), entry("ultra")])).toBe("ultra");
	expect(newestPonytailBranchMode([entry("review")])).toBeUndefined();
});
