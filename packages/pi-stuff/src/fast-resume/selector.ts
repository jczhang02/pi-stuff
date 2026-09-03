import {
	type ExtensionCommandContext,
	SessionManager,
	SessionSelectorComponent,
} from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import type { FastResumeOperationOwner } from "./effect-owner.js";
import { usesDefaultSessionDirectory } from "./host-adapter.js";
import { loadAllSessions, loadCurrentSessions } from "./scanner.js";

function renameSession(path: string, name: string): Effect.Effect<void, Error> {
	return Effect.try({
		try: () => SessionManager.open(path).appendSessionInfo(name),
		catch: () => new Error("Could not rename the Session."),
	});
}

export async function openFastResumeSelector(
	context: ExtensionCommandContext,
	owner: FastResumeOperationOwner,
	initialQuery = "",
): Promise<string | undefined> {
	const cwd = context.sessionManager.getCwd();
	const sessionDir = context.sessionManager.getSessionDir();
	const usesDefaultSessionDir = usesDefaultSessionDirectory(context.sessionManager);
	const currentSessionPath = context.sessionManager.getSessionFile();
	return context.ui.custom<string | undefined>((tui, _theme, keybindings, done) => {
		const selector = new SessionSelectorComponent(
			(onProgress) => owner.run(loadCurrentSessions(sessionDir, cwd, onProgress)),
			(onProgress) => owner.run(loadAllSessions(sessionDir, usesDefaultSessionDir, onProgress)),
			(path) => done(path),
			() => done(undefined),
			() => done(undefined),
			() => tui.requestRender(),
			{
				keybindings,
				renameSession: (path, name) => owner.run(renameSession(path, name ?? "")),
				showRenameHint: currentSessionPath !== undefined,
			},
			currentSessionPath,
		);
		const query = initialQuery.trim();
		if (query) selector.handleInput(query);
		return selector;
	});
}
