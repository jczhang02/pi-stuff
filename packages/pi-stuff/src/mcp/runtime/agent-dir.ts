import { join } from "node:path";
import { getAgentDir as getPiAgentDir } from "@earendil-works/pi-coding-agent";

export function getAgentDir(): string {
	return getPiAgentDir();
}

export function getAgentPath(...segments: string[]): string {
	return join(getAgentDir(), ...segments);
}
