import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isRuntimeString } from "../shared/runtime-type.js";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
// Keep fold ink inside its terminal cells instead of relying on a font's ellipsis bearing.
const PATH_FOLD = "...";

function wellFormedText(value: string): string {
	let output = "";
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				output += value[index] ?? "";
				output += value[index + 1] ?? "";
				index += 1;
			} else {
				output += "�";
			}
			continue;
		}
		output += code >= 0xdc00 && code <= 0xdfff ? "�" : (value[index] ?? "");
	}
	return output;
}

function sanitize(value: string, preserveNewlines: boolean): string {
	const source = wellFormedText(value);
	let output = "";
	for (let index = 0; index < source.length; index += 1) {
		const code = source.charCodeAt(index);
		if (code === 0x1b) {
			const introducer = source.charCodeAt(index + 1);
			if (introducer === 0x5b) {
				index += 2;
				while (index < source.length) {
					const candidate = source.charCodeAt(index);
					if (candidate >= 0x40 && candidate <= 0x7e) break;
					index += 1;
				}
				continue;
			}
			if (
				introducer === 0x5d ||
				introducer === 0x50 ||
				introducer === 0x58 ||
				introducer === 0x5e ||
				introducer === 0x5f
			) {
				index += 2;
				while (index < source.length) {
					const candidate = source.charCodeAt(index);
					if (candidate === 0x07) break;
					if (candidate === 0x1b && source.charCodeAt(index + 1) === 0x5c) {
						index += 1;
						break;
					}
					index += 1;
				}
				continue;
			}
			if (Number.isNaN(introducer)) continue;
			index += 1;
			while (index + 1 < source.length) {
				const candidate = source.charCodeAt(index);
				if (candidate < 0x20 || candidate > 0x2f) break;
				index += 1;
			}
			continue;
		}
		if (code === 0x9b) {
			index += 1;
			while (index < source.length) {
				const candidate = source.charCodeAt(index);
				if (candidate >= 0x40 && candidate <= 0x7e) break;
				index += 1;
			}
			continue;
		}
		if (code === 0x9d || code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
			index += 1;
			while (index < source.length) {
				const candidate = source.charCodeAt(index);
				if (candidate === 0x07 || candidate === 0x9c) break;
				if (candidate === 0x1b && source.charCodeAt(index + 1) === 0x5c) {
					index += 1;
					break;
				}
				index += 1;
			}
			continue;
		}
		if (
			code === 0x061c ||
			(code >= 0x200b && code <= 0x200f) ||
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069)
		) {
			continue;
		}
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			output += preserveNewlines && code === 0x0a ? "\n" : " ";
			continue;
		}
		output += source[index];
	}
	return output;
}

/** Strip terminal control protocols while retaining printable, well-formed Unicode text. */
export function sanitizeTerminalText(value: string): string {
	return sanitize(value, false);
}

/** Sanitize, flatten, and fit one display line by terminal cells without splitting a grapheme. */
export function boundTerminalLine(value: unknown, maximumWidth: number, ellipsis = "…"): string {
	if (!isRuntimeString(value)) return "";
	const width = Math.max(0, Math.floor(maximumWidth));
	const line = sanitizeTerminalText(value).replace(/\s+/gu, " ").trim();
	return sanitizeTerminalText(truncateToWidth(line, width, sanitizeTerminalText(ellipsis)));
}

/** Sanitize and fit a possibly multiline preview by total terminal cells. */
export function boundTerminalText(value: string, maximumWidth: number, ellipsis = "…"): string {
	const width = Math.max(0, Math.floor(maximumWidth));
	return sanitize(truncateToWidth(sanitize(value, true), width, sanitizeTerminalText(ellipsis)), true);
}

/** Preserve the largest complete-grapheme prefix within a separate UTF-16 cap. */
export function graphemePrefix(value: string, maximumCodeUnits: number): string {
	const source = wellFormedText(value);
	const limit = Math.max(0, Math.floor(maximumCodeUnits));
	if (source.length <= limit) return source;
	let output = "";
	for (const { segment } of graphemes.segment(source)) {
		if (output.length + segment.length > limit) break;
		output += segment;
	}
	return output;
}

/** Preserve the largest complete-grapheme suffix within a separate UTF-16 cap. */
export function graphemeSuffix(value: string, maximumCodeUnits: number): string {
	const source = wellFormedText(value);
	const limit = Math.max(0, Math.floor(maximumCodeUnits));
	if (source.length <= limit) return source;
	let kept: string[] = [];
	let head = 0;
	let units = 0;
	for (const { segment } of graphemes.segment(source)) {
		kept.push(segment);
		units += segment.length;
		while (units > limit && head < kept.length) {
			units -= kept[head]?.length ?? 0;
			head += 1;
		}
		if (head >= 1_024) {
			kept = kept.slice(head);
			head = 0;
		}
	}
	return kept.slice(head).join("");
}

/** Preserve complete graphemes within a separate UTF-8 byte cap. */
export function truncateUtf8Graphemes(value: string, maximumBytes: number): string {
	const source = wellFormedText(value);
	const limit = Math.max(0, Math.floor(maximumBytes));
	let output = "";
	let bytes = 0;
	for (const { segment } of graphemes.segment(source)) {
		const segmentBytes = Buffer.byteLength(segment);
		if (bytes + segmentBytes > limit) break;
		output += segment;
		bytes += segmentBytes;
	}
	return output;
}

function pathParts(value: string): {
	readonly origin: string;
	readonly segments: readonly string[];
	readonly separator: "/" | "\\";
} {
	const separator = value.includes("\\") && !value.includes("/") ? "\\" : "/";
	const allSegments = value.split(/[\\/]+/u).filter(Boolean);
	if (value.startsWith("\\\\") || value.startsWith("//")) {
		const fixed = allSegments.slice(0, 2);
		return {
			origin:
				fixed.length === 2 ? `${separator}${separator}${fixed.join(separator)}${separator}` : separator.repeat(2),
			segments: allSegments.slice(fixed.length),
			separator,
		};
	}
	const drive = value.match(/^[A-Za-z]:[\\/]/u)?.[0];
	if (drive) return { origin: `${drive.slice(0, 2)}${separator}`, segments: allSegments.slice(1), separator };
	const relative = value.match(/^(?:(?:\.{1,2})[\\/])+/u)?.[0];
	if (relative) {
		const relativeSegments = relative.split(/[\\/]+/u).filter(Boolean).length;
		return {
			origin: relative.replaceAll(/[\\/]/gu, separator),
			segments: allSegments.slice(relativeSegments),
			separator,
		};
	}
	if (value.startsWith(`~${separator}`)) return { origin: `~${separator}`, segments: allSegments.slice(1), separator };
	if (value.startsWith("/") || value.startsWith("\\")) return { origin: separator, segments: allSegments, separator };
	return { origin: "", segments: allSegments, separator };
}

/** Collapse a path with one shared, cell-aware grammar while retaining its nearest directory and basename. */
export function compactTerminalPath(value: string, maximumWidth: number, collapseDirectories = false): string {
	const width = Math.max(0, Math.floor(maximumWidth));
	const clean = boundTerminalLine(value, Number.MAX_SAFE_INTEGER).replace(
		/(?:[⋯…](?=[\\/])|(?<=[\\/])[⋯…])/gu,
		PATH_FOLD,
	);
	if (!clean || width === 0) return "";
	const { origin, segments, separator } = pathParts(clean);
	const needsCollapse = collapseDirectories && segments.length > 2;
	if (!needsCollapse && visibleWidth(clean) <= width) return clean;

	const basename = segments.at(-1) ?? clean;
	const nearest = segments.at(-2);
	const suffix = nearest ? `${nearest}${separator}${basename}` : basename;
	const foldedSuffix = `${PATH_FOLD}${separator}${suffix}`;
	const foldedBasename = `${PATH_FOLD}${separator}${basename}`;
	const candidates = [`${origin}${foldedSuffix}`, foldedSuffix];
	if (nearest) {
		const prefix = `${PATH_FOLD}${separator}${nearest}${separator}`;
		const fittedBasename = boundTerminalLine(basename, width - visibleWidth(prefix), "…");
		if (fittedBasename) candidates.push(`${prefix}${fittedBasename}`);
	}
	candidates.push(`${origin}${foldedBasename}`, foldedBasename);
	for (const candidate of candidates) {
		if (visibleWidth(candidate) <= width) return candidate;
	}
	return boundTerminalLine(basename, width, "…");
}
