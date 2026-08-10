import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

const root = resolve(import.meta.dir, "..");

export interface WebIntegrationVerificationOptions {
	readonly packagePath?: string;
	readonly publicNetwork?: boolean;
}

type EventHandler = (event: unknown, context: ExtensionContext) => unknown;

function fail(message: string): never {
	throw new Error(`Web integration verification failed: ${message}`);
}

function resultText(result: AgentToolResult<unknown>): string {
	return result.content
		.filter((part): part is Extract<(typeof result.content)[number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function harness(): {
	readonly context: ExtensionContext;
	readonly handlers: Map<string, EventHandler[]>;
	readonly pi: ExtensionAPI;
	readonly tools: Map<string, ToolDefinition>;
} {
	const handlers = new Map<string, EventHandler[]>();
	const tools = new Map<string, ToolDefinition>();
	const events = {};
	const pi = {
		appendEntry: () => undefined,
		events,
		exec: async () => ({ code: 1, killed: false, stderr: "disabled", stdout: "" }),
		on: (event: string, handler: EventHandler) => {
			const listeners = handlers.get(event) ?? [];
			listeners.push(handler);
			handlers.set(event, listeners);
		},
		registerCommand: () => undefined,
		registerShortcut: () => undefined,
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		sendMessage: () => undefined,
	} as unknown as ExtensionAPI;
	const context = {
		cwd: process.cwd(),
		hasUI: false,
		sessionManager: { getBranch: () => [] },
		ui: {},
	} as unknown as ExtensionContext;
	return { context, handlers, pi, tools };
}

async function execute(
	tool: ToolDefinition,
	callId: string,
	parameters: Record<string, unknown>,
	context: ExtensionContext,
): Promise<AgentToolResult<unknown>> {
	return tool.execute(callId, parameters, AbortSignal.timeout(45_000), undefined, context);
}

export async function verifyWebIntegration(options: WebIntegrationVerificationOptions = {}): Promise<void> {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-web-integration-"));
	const priorAgentDirectory = process.env["PI_CODING_AGENT_DIR"];
	const priorKagiApiKey = process.env["KAGI_API_KEY"];
	let pdfOutputPath: string | undefined;
	process.env["PI_CODING_AGENT_DIR"] = join(temporaryDirectory, "agent");
	delete process.env["KAGI_API_KEY"];
	await mkdir(process.env["PI_CODING_AGENT_DIR"]);

	try {
		const packageDirectory = resolve(options.packagePath ?? join(root, "packages/pi-stuff"));
		const { installWebCapability } = await import(pathToFileURL(join(packageDirectory, "src/web/adapter.ts")).href);
		const fixture = harness();
		installWebCapability(fixture.pi);
		for (const handler of fixture.handlers.get("session_start") ?? []) await handler({}, fixture.context);
		const searchTool = fixture.tools.get("web_search");
		const fetchTool = fixture.tools.get("fetch_content");
		const continuationTool = fixture.tools.get("get_search_content");
		if (!searchTool || !fetchTool || !continuationTool) fail("the three bounded Web Tools were not registered");

		if (options.publicNetwork) {
			const search = await execute(
				searchTool,
				"public-search",
				{ numResults: 3, provider: "anysearch", query: "IETF HTTP Semantics RFC 9110 official" },
				fixture.context,
			);
			const searchDetails = search.details as {
				error?: unknown;
				successfulQueries?: unknown;
				totalResults?: unknown;
			};
			if (
				searchDetails.error ||
				searchDetails.successfulQueries !== 1 ||
				typeof searchDetails.totalResults !== "number" ||
				searchDetails.totalResults < 1 ||
				!resultText(search).includes("http")
			) {
				fail("real anonymous public search did not return a cited result");
			}
		}
		const missingCredential = await execute(
			searchTool,
			"missing-credential",
			{ numResults: 1, provider: "kagi", query: "Pi Stuff credential failure fixture" },
			fixture.context,
		);
		const missingCredentialDetails = missingCredential.details as {
			queryCount?: unknown;
			successfulQueries?: unknown;
		};
		if (
			missingCredentialDetails.queryCount !== 1 ||
			missingCredentialDetails.successfulQueries !== 0 ||
			!/Kagi|credential|API key/iu.test(resultText(missingCredential))
		) {
			fail("missing provider credentials were not returned as a visible bounded search failure");
		}

		if (options.publicNetwork) {
			const page = await execute(fetchTool, "public-page", { url: "https://example.com" }, fixture.context);
			if ((page.details as { error?: unknown }).error || !resultText(page).includes("documentation examples")) {
				fail("real public HTML extraction did not return the Example Domain body");
			}
			const redirect = await execute(
				fetchTool,
				"public-redirect",
				{ mode: "raw", url: "http://www.rfc-editor.org/rfc/rfc9110.txt" },
				fixture.context,
			);
			if ((redirect.details as { error?: unknown }).error || !resultText(redirect).includes("HTTP Semantics")) {
				fail("real HTTP-to-HTTPS redirect did not reach its validated RFC Editor destination");
			}

			const pdf = await execute(
				fetchTool,
				"public-pdf",
				{
					url: "https://enterprise.github.com/downloads/en/markdown-cheatsheet.pdf",
				},
				fixture.context,
			);
			const pdfText = resultText(pdf);
			const pdfPathMatch = /^PDF extracted and saved to: (.+)$/mu.exec(pdfText);
			if ((pdf.details as { error?: unknown }).error || !pdfPathMatch?.[1]) {
				fail("real public PDF extraction did not return its Markdown artifact path");
			}
			pdfOutputPath = resolve(pdfPathMatch[1].trim());
			const temporaryRoot = resolve(tmpdir());
			if (!pdfOutputPath.startsWith(`${temporaryRoot}${sep}`)) {
				fail("PDF extraction returned an artifact outside the temporary directory");
			}
			const pdfMarkdown = await readFile(pdfOutputPath, "utf8");
			if (pdfMarkdown.length < 500 || !/markdown|heading|header/iu.test(pdfMarkdown)) {
				fail("real public PDF artifact did not contain extracted document text");
			}

			const longDocument = await execute(
				fetchTool,
				"public-long-document",
				{ url: "https://www.rfc-editor.org/rfc/rfc9110.txt" },
				fixture.context,
			);
			const longDetails = longDocument.details as { error?: unknown; responseId?: unknown };
			if (longDetails.error || typeof longDetails.responseId !== "string") {
				fail("real long-document extraction did not create a continuation id");
			}
			if (resultText(longDocument).length > 55_000) {
				fail("long-document inline result exceeded its bounded budget");
			}
			const continuation = await execute(
				continuationTool,
				"public-long-document-slice",
				{ limit: 2_000, offset: 10_000, responseId: longDetails.responseId, urlIndex: 0 },
				fixture.context,
			);
			const continuationDetails = continuation.details as { error?: unknown; returnedChars?: unknown };
			if (continuationDetails.error || continuationDetails.returnedChars !== 2_000) {
				fail("stored public content could not be retrieved as a bounded continuation slice");
			}
		}

		const local = await execute(fetchTool, "blocked-local", { url: "http://127.0.0.1/private" }, fixture.context);
		if (!(local.details as { error?: string }).error?.includes("Local and private")) {
			fail("local-network input was not rejected at the Suite boundary");
		}
		const networkFailure = await execute(
			fetchTool,
			"network-failure",
			{ url: "https://pi-stuff-network-failure.invalid" },
			fixture.context,
		);
		const failureDetails = networkFailure.details as {
			error?: unknown;
			successful?: unknown;
			urlCount?: unknown;
		};
		if (!failureDetails.error && !(failureDetails.urlCount === 1 && failureDetails.successful === 0)) {
			fail("network failure was not returned as a bounded Tool error");
		}
		if ((await readdir(process.env["PI_CODING_AGENT_DIR"])).includes("web-search.json")) {
			fail("Web compatibility wrote a user settings file");
		}
	} finally {
		if (pdfOutputPath) await rm(pdfOutputPath, { force: true });
		if (priorAgentDirectory === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = priorAgentDirectory;
		if (priorKagiApiKey === undefined) delete process.env["KAGI_API_KEY"];
		else process.env["KAGI_API_KEY"] = priorKagiApiKey;
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}

if (import.meta.main) {
	await verifyWebIntegration({ publicNetwork: true });
	console.log(
		"Certified zero-config public search, HTML, redirect/PDF, continuation, SSRF, and failure paths without settings writes",
	);
}
