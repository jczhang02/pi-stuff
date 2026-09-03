import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ExtensionCommandContext,
	initTheme,
	SessionSelectorComponent,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, KeybindingsManager, setKeybindings, type TUI, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import * as Effect from "effect/Effect";
import type { FastResumeOperationOwner } from "../../packages/pi-stuff/src/fast-resume/effect-owner.js";
import { openFastResumeSelector } from "../../packages/pi-stuff/src/fast-resume/selector.js";

initTheme("dark", false);

function writeSession(dir: string, id: string, message: string): string {
	const path = join(dir, `${id}.jsonl`);
	writeFileSync(
		path,
		`${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: dir })}\n` +
			`${JSON.stringify({ type: "message", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: message } })}\n`,
	);
	return path;
}

async function until(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("native Session selector did not settle");
		await Bun.sleep(1);
	}
}

describe("Fast Resume native selector", () => {
	test("renders and selects through Pi SessionSelectorComponent", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-stuff-fast-resume-selector-"));
		try {
			const active = writeSession(dir, "active", "active message");
			const selected = writeSession(dir, "selected", "selected message");
			let component: Component | undefined;
			const tuiStub = { requestRender: () => undefined };
			// SAFETY: the native selector calls only requestRender on this controlled TUI fixture.
			const tui = tuiStub as TUI;
			const themeStub = {};
			// SAFETY: the selector reads Pi's initialized global theme rather than this factory argument.
			const theme = themeStub as Theme;
			const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
			setKeybindings(keybindings);
			const contextStub = {
				hasUI: true,
				mode: "tui",
				sessionManager: {
					getCwd: () => dir,
					getSessionDir: () => dir,
					getSessionFile: () => active,
				},
				ui: {
					custom: <T>(
						factory: (
							tui: TUI,
							theme: Theme,
							keybindings: KeybindingsManager,
							done: (value: T) => void,
						) => Component,
					) =>
						new Promise<T>((done) => {
							component = factory(tui, theme, keybindings, done);
						}),
				},
			};
			// SAFETY: the selector exercises exactly the supplied Session manager and ui.custom members.
			const context = contextStub as ExtensionCommandContext;
			const owner: FastResumeOperationOwner = {
				run: <A>(program: Effect.Effect<A, Error>) => Effect.runPromise(program),
			};
			const result = openFastResumeSelector(context, owner, "selected");
			await until(() => {
				const rendered = component?.render(100).join("\n") ?? "";
				return rendered.includes("selected message") && !rendered.includes("active message");
			});
			expect(component).toBeInstanceOf(SessionSelectorComponent);
			if (!(component instanceof SessionSelectorComponent)) throw new Error("expected Pi SessionSelectorComponent");
			const rendered = component.render(100).join("\n");
			expect(rendered).toContain("Resume Session (Current Folder)");
			expect(rendered).toContain("selected message");
			expect(rendered).not.toContain("active message");
			expect(rendered).not.toContain("Fast Resume");
			component.getSessionList().handleInput("\r");
			expect(await result).toBe(selected);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});
