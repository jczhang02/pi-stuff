const HARNESS_TOKEN = /<\|(?:assistant|end|im_start|im_end|system|tool|user)[^|>]*\|>/gi;
const ROLE_LINE = /^(\s*)(assistant|developer|system|tool|user)\s*:/i;
const PERMISSION_LINE =
	/^(\s*)(?:permission\s+(?:approved|granted)|allow\s+all|ignore\s+(?:the\s+)?(?:parent|previous|system)\s+instructions)\b/i;

export type AgentReportFinding = "harness-token" | "permission-shaped-line" | "role-shaped-line";

export interface ScannedAgentReport {
	readonly findings: readonly AgentReportFinding[];
	readonly flagged: boolean;
	readonly text: string;
}

function markLine(line: string, findings: Set<AgentReportFinding>): string {
	if (ROLE_LINE.test(line)) {
		findings.add("role-shaped-line");
		return line.replace(ROLE_LINE, "$1[child text: $2]:");
	}
	if (PERMISSION_LINE.test(line)) {
		findings.add("permission-shaped-line");
		return `[child text] ${line}`;
	}
	return line;
}

/**
 * Preserve a child report's meaning while preventing protocol-looking text
 * from being mistaken for a parent message, permission decision, or model
 * harness token. The original report remains in the child artifact; only the
 * parent-facing projection passes through this function.
 */
export function scanAgentReport(source: string): ScannedAgentReport {
	const findings = new Set<AgentReportFinding>();
	const withoutHarnessTokens = source.replace(HARNESS_TOKEN, (token) => {
		findings.add("harness-token");
		return token.replaceAll("<", "‹").replaceAll(">", "›");
	});
	const text = withoutHarnessTokens
		.split("\n")
		.map((line) => markLine(line, findings))
		.join("\n");
	return Object.freeze({
		findings: Object.freeze([...findings]),
		flagged: findings.size > 0,
		text,
	});
}
