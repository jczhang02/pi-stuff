import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePonytailMode, PONYTAIL_DEFAULT_MODE, type PonytailMode } from "./types.js";

const SKILL_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "skills", "ponytail", "SKILL.md");
let canonicalSkill: string | undefined;

export function filterPonytailSkillBodyForMode(body: string, mode: PonytailMode): string {
	const effectiveMode = normalizePonytailMode(mode) ?? PONYTAIL_DEFAULT_MODE;
	const withoutFrontmatter = String(body || "").replace(/^---[\s\S]*?---\s*/u, "");
	return withoutFrontmatter
		.split(/\r?\n/u)
		.filter((line) => {
			const tableLabel = /^\|\s*\*\*(.+?)\*\*\s*\|/u.exec(line);
			if (tableLabel?.[1]) {
				const labelMode = normalizePonytailMode(tableLabel[1].trim());
				if (labelMode && labelMode !== "off") return labelMode === effectiveMode;
			}
			const exampleLabel = /^-\s*([^:]+):\s*"/u.exec(line);
			if (exampleLabel?.[1]) {
				const labelMode = normalizePonytailMode(exampleLabel[1].trim());
				if (labelMode && labelMode !== "off") return labelMode === effectiveMode;
			}
			return true;
		})
		.join("\n");
}

export function preparePonytailInstructions(): string {
	canonicalSkill ??= fs.readFileSync(SKILL_PATH, "utf8");
	return canonicalSkill;
}

export function getPonytailInstructions(mode: PonytailMode): string | undefined {
	if (mode === "off") return undefined;
	const skill = preparePonytailInstructions();
	return `PONYTAIL MODE ACTIVE — level: ${mode}\n\n${filterPonytailSkillBodyForMode(skill, mode)}`;
}

export function clearPonytailInstructionCacheForTest(): void {
	canonicalSkill = undefined;
}
