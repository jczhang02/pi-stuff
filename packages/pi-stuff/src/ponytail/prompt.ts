import {
	type BeforeAgentStartEvent,
	type ExtensionAPI,
	formatSkillsForPrompt,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import { getPonytailInstructions } from "./instructions.js";
import type { PonytailMode } from "./types.js";

export const PONYTAIL_SKILL_NAMES = [
	"ponytail",
	"ponytail-review",
	"ponytail-audit",
	"ponytail-gain",
	"ponytail-debt",
	"ponytail-help",
] as const;

const PONYTAIL_SKILL_NAME_SET = new Set<string>(PONYTAIL_SKILL_NAMES);
const PONYTAIL_CATALOG_MARKER = "<name>ponytail</name>";

function activeTools(pi: ExtensionAPI): readonly string[] | undefined {
	try {
		return pi.getActiveTools();
	} catch {
		return undefined;
	}
}

export class PonytailPromptRenderer {
	private readonly pi: ExtensionAPI;
	private visibleSkills: Skill[] = [];

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	renderAgent(event: BeforeAgentStartEvent, mode: PonytailMode): string | undefined {
		this.visibleSkills = (event.systemPromptOptions.skills ?? []).filter((skill) =>
			PONYTAIL_SKILL_NAME_SET.has(skill.name),
		);
		return this.render(mode, event.systemPrompt);
	}

	renderProvider(mode: PonytailMode): string | undefined {
		return this.render(mode, "");
	}

	private render(mode: PonytailMode, currentSystemPrompt: string): string | undefined {
		const tools = activeTools(this.pi);
		const catalog =
			tools &&
			!tools.includes("read") &&
			this.visibleSkills.length > 0 &&
			!currentSystemPrompt.includes(PONYTAIL_CATALOG_MARKER)
				? formatSkillsForPrompt(this.visibleSkills)
				: undefined;
		const instructions = getPonytailInstructions(mode);
		const parts = [catalog, instructions].filter((part): part is string => Boolean(part?.trim()));
		return parts.length > 0 ? parts.join("\n\n") : undefined;
	}
}
