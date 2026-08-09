import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

type SessionManager = ExtensionContext["sessionManager"];

/**
 * Pi rebuilds the compacted branch and then appends the same compaction
 * message again when a live compaction finishes. Hide the leading replay for
 * exactly that rebuild; persisted entries and later resume rendering remain
 * untouched.
 */
export function suppressDuplicatedLiveCompactionReplay(
	sessionManager: SessionManager,
	compactionEntryId: string,
): boolean {
	const original = sessionManager.buildContextEntries;
	if (typeof original !== "function" || !compactionEntryId) return false;

	const hadOwnMethod = Object.hasOwn(sessionManager, "buildContextEntries");
	const previousDescriptor = Object.getOwnPropertyDescriptor(sessionManager, "buildContextEntries");
	let restored = false;

	const restore = (): void => {
		if (restored) return;
		restored = true;
		const current = Object.getOwnPropertyDescriptor(sessionManager, "buildContextEntries");
		if (current?.value !== wrapped) return;
		try {
			if (hadOwnMethod && previousDescriptor) {
				Object.defineProperty(sessionManager, "buildContextEntries", previousDescriptor);
			} else {
				Reflect.deleteProperty(sessionManager, "buildContextEntries");
			}
		} catch {
			// A Host object becoming immutable must not break compaction itself.
		}
	};

	const wrapped = function (this: SessionManager): SessionEntry[] {
		restore();
		const entries = Reflect.apply(original, this, []) as SessionEntry[];
		const first = entries[0];
		return first?.type === "compaction" && first.id === compactionEntryId ? entries.slice(1) : entries;
	};

	try {
		Object.defineProperty(sessionManager, "buildContextEntries", {
			configurable: true,
			value: wrapped,
			writable: true,
		});
	} catch {
		return false;
	}

	const timer = setTimeout(restore, 0);
	timer.unref?.();
	return true;
}
