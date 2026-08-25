import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

const root = resolve(import.meta.dir, "..");
const upstreamDirectory = join(root, "packages/pi-stuff/src/ponytail");
const upstreamRecordPath = join(upstreamDirectory, "UPSTREAM.md");
const upstreamManifestPath = join(upstreamDirectory, "UPSTREAM.sha256");
const localSkillsDirectory = join(upstreamDirectory, "skills");
const localLicensePath = join(upstreamDirectory, "LICENSE.upstream");
const registryUrl = "https://registry.npmjs.org/@dietrichgebert%2Fponytail";
const packageName = "@dietrichgebert/ponytail";
const modelInvocationAdaptation = "disable-model-invocation: true\n";
const MAX_DIFF_CHARACTERS = 100_000;

const DIST_SCHEMA = Type.Object(
	{
		integrity: Type.String(),
		shasum: Type.Optional(Type.String()),
		tarball: Type.String(),
	},
	{ additionalProperties: true },
);
const VERSION_SCHEMA = Type.Object(
	{
		name: Type.String(),
		version: Type.String(),
		dist: DIST_SCHEMA,
	},
	{ additionalProperties: true },
);
const REGISTRY_SCHEMA = Type.Object(
	{
		"dist-tags": Type.Object({ latest: Type.String() }, { additionalProperties: true }),
		versions: Type.Record(Type.String(), VERSION_SCHEMA),
	},
	{ additionalProperties: true },
);

type RegistryMetadata = Static<typeof REGISTRY_SCHEMA>;
type VersionMetadata = Static<typeof VERSION_SCHEMA>;

export interface PonytailUpstreamReviewOptions {
	readonly version?: string;
}

export interface PonytailUpstreamReview {
	readonly baselineVersion: string;
	readonly candidateVersion: string;
	readonly candidateIntegrity: string;
	readonly candidateChanges: boolean;
	readonly diff: string;
	readonly localBaselineVerified: boolean;
}

interface UpstreamRecord {
	readonly integrity: string;
	readonly version: string;
}

function fail(message: string): never {
	throw new Error(`Ponytail upstream review failed: ${message}`);
}

export function parseUpstreamRecord(contents: string): UpstreamRecord {
	const version = /^- Upstream package: `@dietrichgebert\/ponytail@([^`]+)`$/mu.exec(contents)?.[1];
	const integrity = /^- npm integrity: `([^`]+)`$/mu.exec(contents)?.[1];
	if (!version || !integrity) fail("UPSTREAM.md is missing the pinned package version or npm integrity");
	return { integrity, version };
}

export function stripModelInvocationAdaptation(contents: string): string {
	const occurrences = contents.split(modelInvocationAdaptation).length - 1;
	if (occurrences !== 1) {
		fail(`expected one Pi model-invocation adaptation, found ${String(occurrences)}`);
	}
	return contents.replace(modelInvocationAdaptation, "");
}

export function verifySubresourceIntegrity(bytes: Uint8Array, integrity: string): void {
	const candidates = integrity.trim().split(/\s+/u);
	const sha512 = candidates.find((candidate) => candidate.startsWith("sha512-"));
	if (!sha512) fail("registry metadata does not provide sha512 integrity");
	const expected = sha512.slice("sha512-".length);
	const actual = createHash("sha512").update(bytes).digest("base64");
	if (actual !== expected) fail("downloaded tarball does not match registry sha512 integrity");
}

export function validateArchiveEntries(entries: readonly string[], verboseEntries: readonly string[]): void {
	if (entries.length === 0) fail("npm tarball is empty");
	for (const entry of entries) {
		if (
			!entry.startsWith("package/") ||
			entry.includes("\\") ||
			entry.split("/").some((segment) => segment === "..")
		) {
			fail(`npm tarball contains an unsafe path: ${JSON.stringify(entry)}`);
		}
	}
	for (const entry of verboseEntries) {
		const kind = entry[0];
		if (kind !== "-" && kind !== "d") fail(`npm tarball contains a non-file entry: ${entry}`);
	}
}

export function sanitizeUpstreamDiff(diff: string, baselinePath: string, candidatePath: string): string {
	return diff
		.replaceAll(`a${baselinePath}`, "a/baseline")
		.replaceAll(`b${candidatePath}`, "b/candidate")
		.replaceAll(baselinePath, "baseline")
		.replaceAll(candidatePath, "candidate");
}

function run(arguments_: readonly string[], acceptedExitCodes: readonly number[] = [0]): string {
	const result = Bun.spawnSync([...arguments_], { stderr: "pipe", stdout: "pipe" });
	if (!acceptedExitCodes.includes(result.exitCode)) {
		fail(`${arguments_.join(" ")} exited ${String(result.exitCode)}: ${result.stderr.toString().trim()}`);
	}
	return result.stdout.toString();
}

async function registryMetadata(): Promise<RegistryMetadata> {
	const response = await fetch(registryUrl, { headers: { accept: "application/vnd.npm.install-v1+json" } });
	if (!response.ok) fail(`npm registry returned HTTP ${String(response.status)}`);
	const value = JSON.parse(await response.text());
	if (!Check(REGISTRY_SCHEMA, value)) fail("npm registry returned malformed Ponytail metadata");
	return value;
}

function resolveVersion(metadata: RegistryMetadata, requested: string | undefined): VersionMetadata {
	const version = requested ?? metadata["dist-tags"].latest;
	const candidate = metadata.versions[version];
	if (!candidate || candidate.name !== packageName || candidate.version !== version) {
		fail(`npm registry does not contain ${packageName}@${version}`);
	}
	const tarball = new URL(candidate.dist.tarball);
	if (tarball.protocol !== "https:" || tarball.hostname !== "registry.npmjs.org") {
		fail(`registry supplied an untrusted tarball URL: ${candidate.dist.tarball}`);
	}
	return candidate;
}

async function downloadAndExtract(metadata: VersionMetadata, directory: string): Promise<string> {
	await mkdir(directory, { recursive: true });
	const response = await fetch(metadata.dist.tarball);
	if (!response.ok) fail(`tarball download returned HTTP ${String(response.status)}`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	verifySubresourceIntegrity(bytes, metadata.dist.integrity);
	const archive = join(directory, "package.tgz");
	await writeFile(archive, bytes, { mode: 0o600 });
	const entries = run(["tar", "-tzf", archive]).trim().split("\n").filter(Boolean);
	const verboseEntries = run(["tar", "-tvzf", archive]).trim().split("\n").filter(Boolean);
	validateArchiveEntries(entries, verboseEntries);
	const extracted = join(directory, "extracted");
	await mkdir(extracted);
	run(["tar", "-xzf", archive, "--no-same-owner", "--no-same-permissions", "-C", extracted]);
	return join(extracted, "package");
}

function parseManifest(contents: string): ReadonlyMap<string, string> {
	const entries = new Map<string, string>();
	for (const line of contents.trim().split("\n")) {
		const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
		if (!match?.[1] || !match[2]) fail(`malformed upstream hash manifest line: ${line}`);
		entries.set(match[2], match[1]);
	}
	return entries;
}

function sha256(contents: string | Uint8Array): string {
	return createHash("sha256").update(contents).digest("hex");
}

async function findLicense(packageDirectory: string): Promise<string> {
	const entries = await readdir(packageDirectory);
	const name = entries.find((entry) => /^licen[sc]e(?:\..+)?$/iu.test(entry));
	if (!name) fail(`${basename(packageDirectory)} has no license file`);
	return join(packageDirectory, name);
}

async function verifyLocalBaseline(packageDirectory: string): Promise<void> {
	const manifest = parseManifest(await readFile(upstreamManifestPath, "utf8"));
	const localSkillNames = (await readdir(localSkillsDirectory)).sort();
	const upstreamSkillNames = (await readdir(join(packageDirectory, "skills"))).sort();
	if (JSON.stringify(localSkillNames) !== JSON.stringify(upstreamSkillNames)) {
		fail(
			`local/upstream Skill inventories differ: ${JSON.stringify(localSkillNames)} / ${JSON.stringify(upstreamSkillNames)}`,
		);
	}
	for (const name of localSkillNames) {
		const relativePath = `skills/${name}/SKILL.md`;
		const local = stripModelInvocationAdaptation(
			await readFile(join(localSkillsDirectory, name, "SKILL.md"), "utf8"),
		);
		const upstream = await readFile(join(packageDirectory, relativePath), "utf8");
		if (local !== upstream) fail(`local Skill differs beyond the reviewed frontmatter adaptation: ${relativePath}`);
		if (manifest.get(relativePath) !== sha256(upstream)) fail(`hash manifest differs for ${relativePath}`);
	}
	const localLicense = await readFile(localLicensePath, "utf8");
	const upstreamLicense = await readFile(await findLicense(packageDirectory), "utf8");
	if (localLicense !== upstreamLicense) fail("retained upstream license differs from the npm baseline");
	if (manifest.get("LICENSE.upstream") !== sha256(upstreamLicense)) fail("hash manifest differs for LICENSE.upstream");
	if (manifest.size !== localSkillNames.length + 1) fail("hash manifest contains unexpected resources");
}

function upstreamDiff(baselinePath: string, candidatePath: string): string {
	const result = Bun.spawnSync(
		["git", "diff", "--no-index", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", baselinePath, candidatePath],
		{ stderr: "pipe", stdout: "pipe" },
	);
	if (result.exitCode !== 0 && result.exitCode !== 1) {
		fail(`git diff exited ${String(result.exitCode)}: ${result.stderr.toString().trim()}`);
	}
	const sanitized = sanitizeUpstreamDiff(result.stdout.toString(), baselinePath, candidatePath);
	return sanitized.length <= MAX_DIFF_CHARACTERS
		? sanitized
		: `${sanitized.slice(0, MAX_DIFF_CHARACTERS)}\n[diff truncated after ${String(MAX_DIFF_CHARACTERS)} characters]\n`;
}

export async function reviewPonytailUpstream(
	options: PonytailUpstreamReviewOptions = {},
): Promise<PonytailUpstreamReview> {
	const upstreamRecord = parseUpstreamRecord(await readFile(upstreamRecordPath, "utf8"));
	const metadata = await registryMetadata();
	const baseline = resolveVersion(metadata, upstreamRecord.version);
	if (baseline.dist.integrity !== upstreamRecord.integrity) {
		fail("registry integrity for the pinned version differs from UPSTREAM.md");
	}
	const candidate = resolveVersion(metadata, options.version);
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-stuff-ponytail-upstream-"));
	try {
		const baselinePath = await downloadAndExtract(baseline, join(temporaryDirectory, "baseline"));
		await verifyLocalBaseline(baselinePath);
		const candidatePath =
			candidate.version === baseline.version
				? baselinePath
				: await downloadAndExtract(candidate, join(temporaryDirectory, "candidate"));
		const diff = candidatePath === baselinePath ? "" : upstreamDiff(baselinePath, candidatePath);
		return {
			baselineVersion: baseline.version,
			candidateVersion: candidate.version,
			candidateIntegrity: candidate.dist.integrity,
			candidateChanges: diff.length > 0,
			diff,
			localBaselineVerified: true,
		};
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

function requestedVersion(arguments_: readonly string[]): string | undefined {
	if (arguments_.length === 0) return undefined;
	if (arguments_.length === 2 && arguments_[0] === "--version" && arguments_[1]) return arguments_[1];
	fail("usage: bun run ponytail:upstream:review [--version <version>]");
}

if (import.meta.main) {
	const version = requestedVersion(process.argv.slice(2));
	const review = await reviewPonytailUpstream(version ? { version } : {});
	console.log(
		[
			`Ponytail upstream baseline: ${review.baselineVersion}`,
			`Candidate: ${review.candidateVersion}`,
			`Integrity: ${review.candidateIntegrity}`,
			"Local baseline resources/license: verified",
			review.diff ? `\nReviewed upstream package diff:\n${review.diff}` : "Candidate matches the pinned package.",
		].join("\n"),
	);
	if (review.candidateVersion !== review.baselineVersion) process.exitCode = 2;
}
