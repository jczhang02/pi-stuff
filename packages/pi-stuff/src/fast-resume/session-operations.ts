import * as Effect from "effect/Effect";
import {
	type DeleteSessionResult,
	deleteSessionFileNative,
	type NativeDeleteOptions,
	renameSessionFileNative,
} from "./session-operations-native.js";

export type { DeleteSessionResult } from "./session-operations-native.js";

export function renameSessionFile(path: string, name: string): Effect.Effect<void, Error> {
	const nextName = name.trim();
	if (!nextName) return Effect.fail(new Error("Session name cannot be empty."));
	return Effect.try({
		try: () => renameSessionFileNative(path, nextName),
		catch: () => new Error("Could not rename the Session."),
	});
}

export function deleteSessionFile(path: string, options?: NativeDeleteOptions): Effect.Effect<DeleteSessionResult> {
	return Effect.sync(() => deleteSessionFileNative(path, options));
}
