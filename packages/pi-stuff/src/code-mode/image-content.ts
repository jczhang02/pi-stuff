import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { getImageDimensions } from "@earendil-works/pi-tui";

export const INVALID_CODE_MODE_IMAGE_MESSAGE =
	"Code Mode rejected an invalid or incomplete image. Use an image-producing Tool such as tools.read instead of Base64 from a text Tool.";

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_END = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

type ToolContent = AgentToolResult<unknown>["content"];
type ImageContent = Extract<ToolContent[number], { type: "image" }>;

type SupportedImageMimeType = "image/gif" | "image/jpeg" | "image/png" | "image/webp";

export interface SanitizedCodeModeContent {
	readonly content: ToolContent;
	readonly rejected: number;
}

function supportedMimeType(value: string): SupportedImageMimeType | undefined {
	const normalized = value.trim().toLowerCase();
	switch (normalized) {
		case "image/gif":
		case "image/png":
		case "image/webp":
			return normalized;
		case "image/jpeg":
		case "image/jpg":
			return "image/jpeg";
		default:
			return undefined;
	}
}

function decodeBase64(data: string): Buffer | undefined {
	if (!data || data.length % 4 !== 0 || !BASE64_PATTERN.test(data)) return undefined;
	const bytes = Buffer.from(data, "base64");
	return bytes.length > 0 && bytes.toString("base64") === data ? bytes : undefined;
}

function hasCompleteEnvelope(bytes: Buffer, mimeType: SupportedImageMimeType): boolean {
	switch (mimeType) {
		case "image/png":
			return (
				bytes.length >= 24 &&
				bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) &&
				bytes.subarray(-PNG_END.length).equals(PNG_END)
			);
		case "image/jpeg":
			return (
				bytes.length >= 4 &&
				bytes[0] === 0xff &&
				bytes[1] === 0xd8 &&
				bytes[bytes.length - 2] === 0xff &&
				bytes[bytes.length - 1] === 0xd9
			);
		case "image/gif": {
			const signature = bytes.subarray(0, 6).toString("ascii");
			return (
				bytes.length >= 14 && (signature === "GIF87a" || signature === "GIF89a") && bytes[bytes.length - 1] === 0x3b
			);
		}
		case "image/webp":
			return (
				bytes.length >= 20 &&
				bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
				bytes.subarray(8, 12).toString("ascii") === "WEBP" &&
				bytes.readUInt32LE(4) + 8 === bytes.length
			);
	}
}

export function isValidCodeModeImage(image: ImageContent): boolean {
	try {
		const mimeType = supportedMimeType(image.mimeType);
		if (!mimeType) return false;
		const bytes = decodeBase64(image.data);
		if (!bytes || !hasCompleteEnvelope(bytes, mimeType)) return false;
		const dimensions = getImageDimensions(image.data, mimeType);
		return dimensions !== null && dimensions.widthPx > 0 && dimensions.heightPx > 0;
	} catch {
		return false;
	}
}

export function codeModeImageFromDataUrl(value: string): ImageContent {
	const match = value.match(/^data:([^;,]+);base64,(.*)$/su);
	const mimeType = match?.[1] ? supportedMimeType(match[1]) : undefined;
	const image: ImageContent | undefined =
		match && mimeType ? { type: "image", data: match[2] ?? "", mimeType } : undefined;
	if (!image || !isValidCodeModeImage(image)) throw new Error(INVALID_CODE_MODE_IMAGE_MESSAGE);
	return image;
}

export function assertValidSupportedCodeModeImages(content: readonly ToolContent[number][]): void {
	for (const item of content) {
		if (item.type !== "image" || !supportedMimeType(item.mimeType)) continue;
		if (!isValidCodeModeImage(item)) throw new Error(INVALID_CODE_MODE_IMAGE_MESSAGE);
	}
}

export function sanitizeCodeModeContent(content: readonly ToolContent[number][]): SanitizedCodeModeContent {
	let rejected = 0;
	const sanitized = content.map((item) => {
		if (item.type !== "image" || isValidCodeModeImage(item)) return item;
		rejected += 1;
		return { type: "text" as const, text: INVALID_CODE_MODE_IMAGE_MESSAGE };
	});
	return { content: rejected > 0 ? sanitized : [...content], rejected };
}
