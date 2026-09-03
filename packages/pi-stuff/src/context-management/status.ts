import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NativeCompactionSettings } from "./magic-runtime.js";

export type ContextActivationTrigger = "startup" | "input" | "automatic-turn" | "projection";
export type ContextCapabilityState = "dormant" | "loading" | "active" | "native" | "degraded";

export interface ContextStatusSnapshot {
	readonly continuity?: "degraded";
	readonly continuityDetail?: string;
	readonly state: ContextCapabilityState;
	readonly engine: "magic-context" | "native";
	readonly trigger?: ContextActivationTrigger;
	readonly error?: string;
}

const NATIVE_COMPACTION_DISABLED_DETAIL =
	"Pi native auto-compaction is disabled. Run /settings and enable auto-compaction so Pi can recover if Magic Context becomes unavailable.";

export function nativeContextStatus(trigger: ContextActivationTrigger): ContextStatusSnapshot {
	return { state: "native", engine: "native", trigger };
}

export function contextStatusWithContinuity(
	state: ContextStatusSnapshot,
	ctx: ExtensionContext | undefined,
	readNativeCompactionSettings: (ctx: ExtensionContext) => NativeCompactionSettings | undefined,
): ContextStatusSnapshot {
	if (state.state !== "active" || !ctx) return { ...state };
	try {
		return readNativeCompactionSettings(ctx)?.enabled === false
			? { ...state, continuity: "degraded", continuityDetail: NATIVE_COMPACTION_DISABLED_DETAIL }
			: { ...state };
	} catch {
		return { ...state };
	}
}
