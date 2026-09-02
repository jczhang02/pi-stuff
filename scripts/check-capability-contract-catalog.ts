import { access, readFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { isJsonInputObject, parseJsonValue } from "../packages/pi-stuff/src/shared/json-value.js";
import { isRuntimeString } from "../packages/pi-stuff/src/shared/runtime-type.js";

const CATALOG_PATH = "docs/capability-contract-catalog.md";
const SUITE_PATH = "packages/pi-stuff/suite.json";
const HEADER =
	"| ID | Capability | Behavior authority | Public seam | Scenarios | Evidence profile | Evidence | Status |";
const CONTRACT_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/u;
const REPORT_DATE_PATTERN = /(?:^|[-_])(?:\d{4}-\d{2}-\d{2}|\d{8})(?=\.md$|[-_.])/u;
const EVIDENCE_PROFILES = new Set([
	"packed-package/real-host",
	"real-host",
	"real-host/fixture-provider",
	"real-host/fixture-service",
	"real-host/live-provider",
	"real-host/live-service",
]);
const SCENARIO_FACETS = new Set(["boundary", "failure", "normal", "persistence", "recovery"]);

export interface CatalogFinding {
	readonly path: string;
	readonly rule: string;
}

interface CatalogEntry {
	readonly id: string;
	readonly capability: string;
	readonly behavior: string;
	readonly publicSeam: string;
	readonly scenarios: string;
	readonly evidenceProfile: string;
	readonly evidence: string;
	readonly status: string;
}

function inlineCode(value: string): string | undefined {
	return value.match(/^`([^`]+)`$/u)?.[1];
}

function parseEntries(source: string) {
	const entries: CatalogEntry[] = [];
	const malformedRows: number[] = [];
	for (const [index, line] of source.split(/\r?\n/u).entries()) {
		if (!line.startsWith("|") || line === HEADER || line.startsWith("| ---")) continue;
		const cells = line
			.slice(1, line.endsWith("|") ? -1 : undefined)
			.split("|")
			.map((cell) => cell.trim());
		const id = cells[0] ? inlineCode(cells[0]) : undefined;
		const capability = cells[1] ? inlineCode(cells[1]) : undefined;
		if (!line.endsWith("|") || cells.length !== 8 || !id || !capability) {
			malformedRows.push(index + 1);
			continue;
		}
		entries.push({
			id,
			capability,
			behavior: cells[2] ?? "",
			publicSeam: cells[3] ?? "",
			scenarios: cells[4] ?? "",
			evidenceProfile: inlineCode(cells[5] ?? "") ?? "",
			evidence: cells[6] ?? "",
			status: cells[7] ?? "",
		});
	}
	return { entries, malformedRows };
}

function markdownLinks(value: string): string[] {
	return [...value.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)].flatMap((match) => (match[1] ? [match[1]] : []));
}

function repositoryTarget(rawTarget: string): string | undefined {
	const target = rawTarget.split("#", 1)[0];
	if (!target || /^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith("/")) return undefined;
	const normalized = posix.normalize(posix.join(posix.dirname(CATALOG_PATH), target));
	return normalized === ".." || normalized.startsWith("../") ? undefined : normalized;
}

async function exists(root: string, path: string): Promise<boolean> {
	try {
		await access(join(root, path));
		return true;
	} catch {
		return false;
	}
}

function aggregateReportStatus(source: string, id: string): "blocked" | "fail" | "pass" | undefined {
	const rows = source.split(/\r?\n/u).filter((line) => line.startsWith(`| \`${id}\` |`));
	if (rows.length !== 1) return undefined;
	const results = inlineCode(rows[0]?.split("|")[2]?.trim() ?? "")
		?.split(";")
		.map((pair) => pair.trim().split("=")[1]);
	if (!results?.length || results.some((result) => !result || !["blocked", "fail", "pass"].includes(result))) {
		return undefined;
	}
	if (results.includes("fail")) return "fail";
	return results.includes("blocked") ? "blocked" : "pass";
}

async function auditEntry(
	root: string,
	entry: CatalogEntry,
	reports: Map<string, Promise<string | undefined>>,
): Promise<CatalogFinding[]> {
	const findings: CatalogFinding[] = [];
	const expectedReadme = `packages/pi-stuff/src/${entry.capability}/README.md`;
	const behaviorTargets = markdownLinks(entry.behavior).map(repositoryTarget);
	if (behaviorTargets.length !== 1 || behaviorTargets[0] !== expectedReadme || !(await exists(root, expectedReadme))) {
		findings.push({ path: CATALOG_PATH, rule: `behavior-authority:${entry.id}` });
	}
	if (!entry.publicSeam) findings.push({ path: CATALOG_PATH, rule: `public-seam:${entry.id}` });

	const seenFacets = new Set<string>();
	for (const scenario of entry.scenarios.split(";").map((value) => value.trim())) {
		const separator = scenario.indexOf(":");
		const facet = separator < 0 ? scenario : scenario.slice(0, separator).trim();
		const description = separator < 0 ? "" : scenario.slice(separator + 1).trim();
		if (!SCENARIO_FACETS.has(facet) || !description || seenFacets.has(facet)) {
			findings.push({ path: CATALOG_PATH, rule: `scenario:${entry.id}:${facet}` });
		}
		seenFacets.add(facet);
	}
	if (!seenFacets.has("normal")) findings.push({ path: CATALOG_PATH, rule: `scenario-normal:${entry.id}` });
	if (!EVIDENCE_PROFILES.has(entry.evidenceProfile)) {
		findings.push({ path: CATALOG_PATH, rule: `evidence-profile:${entry.id}:${entry.evidenceProfile}` });
	}

	const evidenceTargets = markdownLinks(entry.evidence).map(repositoryTarget);
	if (
		evidenceTargets.length === 0 ||
		(await Promise.all(evidenceTargets.map((target) => target !== undefined && exists(root, target)))).includes(false)
	) {
		findings.push({ path: CATALOG_PATH, rule: `evidence:${entry.id}` });
	}

	const pending = inlineCode(entry.status) === "pending";
	const reported = entry.status.match(/^\[(pass|fail|blocked)\]\(([^)]+)\)$/u);
	if (!pending && !reported) {
		findings.push({ path: CATALOG_PATH, rule: `status:${entry.id}` });
	} else if (reported) {
		const target = repositoryTarget(reported[2] ?? "");
		if (
			!target?.startsWith("docs/reports/") ||
			!REPORT_DATE_PATTERN.test(posix.basename(target)) ||
			!(await exists(root, target))
		) {
			findings.push({ path: CATALOG_PATH, rule: `status-report:${entry.id}` });
		} else {
			let report = reports.get(target);
			if (!report) {
				report = readFile(join(root, target), "utf8").then(
					(source) => source,
					() => undefined,
				);
				reports.set(target, report);
			}
			const aggregate = aggregateReportStatus((await report) ?? "", entry.id);
			if (aggregate !== reported[1]) {
				findings.push({
					path: CATALOG_PATH,
					rule: `status-result:${entry.id}:${reported[1]}:${aggregate ?? "missing"}`,
				});
			}
		}
	}
	return findings;
}

function readCapabilities(source: string): string[] | undefined {
	try {
		const value = parseJsonValue(source);
		if (!isJsonInputObject(value)) return undefined;
		const capabilities = value["capabilities"];
		return Array.isArray(capabilities) && capabilities.every(isRuntimeString) ? capabilities : undefined;
	} catch {
		return undefined;
	}
}

export async function auditCapabilityContractCatalog(root: string): Promise<CatalogFinding[]> {
	let suiteSource: string;
	let catalogSource: string;
	try {
		suiteSource = await readFile(join(root, SUITE_PATH), "utf8");
	} catch {
		return [{ path: SUITE_PATH, rule: "suite-manifest" }];
	}
	try {
		catalogSource = await readFile(join(root, CATALOG_PATH), "utf8");
	} catch {
		return [{ path: CATALOG_PATH, rule: "catalog-missing" }];
	}
	const capabilities = readCapabilities(suiteSource);
	if (!capabilities) return [{ path: SUITE_PATH, rule: "suite-capabilities" }];
	const findings: CatalogFinding[] = [];
	if (!catalogSource.includes(HEADER)) findings.push({ path: CATALOG_PATH, rule: "table-header" });
	const { entries, malformedRows } = parseEntries(catalogSource);
	for (const line of malformedRows) findings.push({ path: CATALOG_PATH, rule: `row-format:${String(line)}` });

	const capabilitySet = new Set(capabilities);
	const ids = new Set<string>();
	const reports = new Map<string, Promise<string | undefined>>();
	for (const entry of entries) {
		if (!CONTRACT_ID_PATTERN.test(entry.id)) findings.push({ path: CATALOG_PATH, rule: `id-format:${entry.id}` });
		if (ids.has(entry.id)) findings.push({ path: CATALOG_PATH, rule: `id-duplicate:${entry.id}` });
		ids.add(entry.id);
		if (!capabilitySet.has(entry.capability)) {
			findings.push({ path: CATALOG_PATH, rule: `capability-unknown:${entry.capability}` });
			continue;
		}
		if (!entry.id.startsWith(`${entry.capability}.`)) {
			findings.push({ path: CATALOG_PATH, rule: `id-owner:${entry.id}:${entry.capability}` });
		}
		findings.push(...(await auditEntry(root, entry, reports)));
	}
	for (const capability of capabilities) {
		if (!entries.some((entry) => entry.capability === capability)) {
			findings.push({ path: CATALOG_PATH, rule: `capability-missing:${capability}` });
		}
	}
	return findings;
}

if (import.meta.main) {
	const findings = await auditCapabilityContractCatalog(resolve(import.meta.dir, ".."));
	if (findings.length > 0) {
		for (const finding of findings) console.error(`${finding.path}: ${finding.rule}`);
		process.exitCode = 1;
	} else {
		console.log("Capability Contract Catalog checks passed");
	}
}
