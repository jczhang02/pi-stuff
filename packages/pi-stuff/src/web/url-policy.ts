import { isIP } from "node:net";

const MAX_URLS = 10;
const MAX_URL_LENGTH = 8_192;

export interface WebFetchInput {
	readonly mode?: "raw" | "readable";
	readonly url?: string;
	readonly urls?: readonly string[];
}

interface ValidatedWebFetchInput {
	mode?: "raw" | "readable";
	url?: string;
	urls?: string[];
}

export type WebFetchValidation =
	| {
			readonly input: ValidatedWebFetchInput;
			readonly ok: true;
	  }
	| { readonly error: string; readonly ok: false };

function privateIpv4(hostname: string): boolean {
	const octets = hostname.split(".").map(Number);
	if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return false;
	}
	const [first = 0, second = 0] = octets;
	return (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168)
	);
}

function privateIpv6(hostname: string): boolean {
	const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
	return (
		normalized === "::" ||
		normalized === "::1" ||
		normalized.startsWith("fc") ||
		normalized.startsWith("fd") ||
		/^fe[89ab]/u.test(normalized) ||
		normalized.startsWith("::ffff:127.") ||
		normalized.startsWith("::ffff:10.") ||
		normalized.startsWith("::ffff:192.168.")
	);
}

function localHostname(hostname: string): boolean {
	const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
	if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true;
	const family = isIP(normalized);
	if (family === 4) return privateIpv4(normalized);
	if (family === 6) return privateIpv6(normalized);
	return false;
}

function validateUrl(raw: string): string | undefined {
	if (raw.length === 0) return "URL must not be empty.";
	if (raw.length > MAX_URL_LENGTH) return `URL exceeds ${String(MAX_URL_LENGTH)} characters.`;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return "Invalid URL.";
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Only HTTP(S) URLs are supported.";
	if (parsed.username || parsed.password) return "Credential-bearing URLs are not supported.";
	if (localHostname(parsed.hostname)) return "Local and private network URLs are not supported.";
	if (isIP(parsed.hostname.replace(/^\[|\]$/gu, "")) !== 0) return "Literal IP URLs are not supported.";
	return undefined;
}

/** Validate the Suite boundary before the fork performs its DNS/IP SSRF checks. */
export function validateWebFetchInput(input: WebFetchInput): WebFetchValidation {
	const hasSingle = input.url !== undefined;
	const hasMany = input.urls !== undefined;
	if (hasSingle === hasMany) return { error: "Provide exactly one of url or urls.", ok: false };
	const urls = hasSingle ? [input.url ?? ""] : [...(input.urls ?? [])];
	if (urls.length === 0) return { error: "Provide at least one URL.", ok: false };
	if (urls.length > MAX_URLS) return { error: `At most ${String(MAX_URLS)} URLs may be fetched at once.`, ok: false };
	for (const url of urls) {
		const error = validateUrl(url);
		if (error) return { error, ok: false };
	}
	const validatedInput: ValidatedWebFetchInput = hasSingle ? { url: urls[0] ?? "" } : { urls };
	if (input.mode) validatedInput.mode = input.mode;
	return { input: validatedInput, ok: true };
}
