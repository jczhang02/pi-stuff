import { parseJsonObject, type JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeString } from "../../shared/runtime-type.js";
import { readWebConfigText, webConfigExists } from "../settings.ts";

import { getWebSearchConfigPath } from "./utils.ts";

const CONFIG_PATH = `${getWebSearchConfigPath()} under "web"`;

interface GeminiWebConfig {
	chromeProfile?: string;
	allowBrowserCookies?: boolean;
}

let cachedConfig: GeminiWebConfig | null = null;

export function normalizeChromeProfile(value: JsonInputValue): string | undefined {
	if (!isRuntimeString(value)) return undefined;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function loadConfig(): GeminiWebConfig {
	if (!webConfigExists()) {
		cachedConfig = {};
		return cachedConfig;
	}

	const rawText = readWebConfigText();
	let raw;
	try {
		raw = parseJsonObject(rawText);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}

	cachedConfig = {
		chromeProfile: normalizeChromeProfile(raw.chromeProfile),
		allowBrowserCookies: raw.allowBrowserCookies === true,
	};
	return cachedConfig;
}

export function getChromeProfileFromConfig(): string | undefined {
	return loadConfig().chromeProfile;
}

export function isBrowserCookieAccessAllowed(): boolean {
	if (process.env.PI_ALLOW_BROWSER_COOKIES === "1" || process.env.FEYNMAN_ALLOW_BROWSER_COOKIES === "1") {
		return true;
	}
	return loadConfig().allowBrowserCookies === true;
}
