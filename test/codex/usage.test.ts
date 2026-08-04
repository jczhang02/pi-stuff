import { expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	buildCodexUsageUrl,
	fetchCodexUsage,
	formatCodexUsage,
	parseCodexUsage,
	weeklyRemainingPercent,
} from "../../packages/pi-stuff-codex/usage.js";

function jwt(accountId: string): string {
	const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none" })}.${encode({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })}.x`;
}

test("normalizes primary and secondary Codex windows", () => {
	const usage = parseCodexUsage({
		plan_type: "pro",
		rate_limit: {
			primary_window: { resets_at: 1_800_000_000, used_percent: 25, window_minutes: 300 },
			secondary_window: { resets_at: 1_800_500_000, used_percent: 72.4, window_minutes: 10_080 },
		},
	});
	expect(usage).toEqual({
		fiveHour: { resetsAt: 1_800_000_000, usedPercent: 25, windowMinutes: 300 },
		plan: "pro",
		weekly: { resetsAt: 1_800_500_000, usedPercent: 72.4, windowMinutes: 10_080 },
	});
	expect(weeklyRemainingPercent(usage)).toBeCloseTo(27.6);
	expect(formatCodexUsage(usage)).toContain("Weekly 28% left");
});

test("recognizes accounts where the weekly window is the only primary window", () => {
	const usage = parseCodexUsage({
		rate_limit: { primary: { limit_window_seconds: 604_800, used_percent: 4 } },
	});
	expect(usage.fiveHour).toBeUndefined();
	expect(usage.weekly).toEqual({ usedPercent: 4, windowMinutes: 10_080 });
	expect(weeklyRemainingPercent(usage)).toBe(96);
});

test("builds the authenticated usage request only when explicitly invoked", async () => {
	const token = jwt("account-42");
	const ctx = {
		model: {
			api: "openai-responses",
			baseUrl: "https://chatgpt.com/backend-api/codex/responses",
			headers: {},
			id: "gpt-5.2-codex",
			input: ["text"],
			provider: "openai-codex",
		},
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({ apiKey: token, headers: {}, ok: true }),
		},
	} as unknown as ExtensionContext;
	let request: Request | undefined;
	const usage = await fetchCodexUsage(ctx, async (input, init) => {
		if (input instanceof Request) request = new Request(input, init);
		else request = new Request(input.toString(), init);
		return new Response(JSON.stringify({ rate_limit: { secondary: { used_percent: 10, window_minutes: 10_080 } } }), {
			status: 200,
		});
	});
	expect(request?.url).toBe("https://chatgpt.com/backend-api/wham/usage");
	expect(request?.headers.get("authorization")).toBe(`Bearer ${token}`);
	expect(request?.headers.get("chatgpt-account-id")).toBe("account-42");
	expect(weeklyRemainingPercent(usage)).toBe(90);
	expect(buildCodexUsageUrl("https://example.test/codex/responses")).toBe("https://example.test/wham/usage");
});
