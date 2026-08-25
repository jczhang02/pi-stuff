export const PONYTAIL_MODES = ["off", "lite", "full", "ultra"] as const;

export type PonytailMode = (typeof PONYTAIL_MODES)[number];

export const PONYTAIL_DEFAULT_MODE: PonytailMode = "full";
export const PONYTAIL_SESSION_ENTRY_TYPE = "ponytail-mode";
export const PONYTAIL_CHILD_MODE_ENV = "PI_STUFF_PONYTAIL_MODE";

export interface PonytailSavedSettings {
	readonly defaultMode: PonytailMode;
	readonly hideStatus: boolean;
	readonly quietStartup: boolean;
}

export interface PonytailEffectiveSettings extends PonytailSavedSettings {
	readonly saved: PonytailSavedSettings;
	readonly source: "defaults" | "legacy" | "merged";
	readonly defaultModeOverridden: boolean;
	readonly hideStatusOverridden: boolean;
	readonly quietStartupOverridden: boolean;
	readonly writable: boolean;
	readonly error?: string;
}

export function normalizePonytailMode(value: unknown): PonytailMode | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return PONYTAIL_MODES.find((mode) => mode === normalized);
}

export function isPonytailDeactivationCommand(value: unknown): boolean {
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/[.!?\s]+$/u, "");
	return normalized === "stop ponytail" || normalized === "normal mode";
}
