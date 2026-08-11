import { compactTerminalPath } from "../../../tool-display/index.js";

export function compactPath(path: string, maxLength: number): string {
	return compactTerminalPath(path, maxLength);
}
