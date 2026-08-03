import { resolve } from "node:path";

const BEAD_ID_PATTERN = /^ps-[a-z0-9]+(?:\.[0-9]+)*$/;
const root = resolve(import.meta.dir, "..");

function run(command: readonly string[], environment: Record<string, string | undefined>): string {
	const result = Bun.spawnSync([...command], {
		cwd: root,
		env: environment,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0) {
		throw new Error(`${command[0]} failed: ${stderr.trim() || stdout.trim()}`);
	}
	if (stdout.length > 0) {
		process.stdout.write(stdout);
	}
	if (stderr.length > 0) {
		process.stderr.write(stderr);
	}
	return stdout;
}

function githubToken(): string {
	const { GITHUB_TOKEN } = process.env;
	if (GITHUB_TOKEN) {
		return GITHUB_TOKEN;
	}
	const result = Bun.spawnSync(["gh", "auth", "token"], { cwd: root, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(`Unable to obtain GitHub authentication: ${result.stderr.toString().trim()}`);
	}
	const token = result.stdout.toString().trim();
	if (token.length === 0) {
		throw new Error("GitHub authentication returned an empty token");
	}
	return token;
}

const [beadId, ...extraArguments] = process.argv.slice(2);
if (!beadId || extraArguments.length > 0 || !BEAD_ID_PATTERN.test(beadId)) {
	throw new Error("Usage: bun run beads:publish -- <ps-bead-id>");
}

const environment = { ...process.env, GITHUB_TOKEN: githubToken() };
const syncCommand = ["bd", "github", "sync", "--push-only", "--parent", beadId] as const;
run([...syncCommand, "--dry-run"], environment);
run(syncCommand, environment);

// GitHub creates every new issue open. Once the first pass records external_ref,
// a second pass applies the canonical Beads state to newly created closed issues.
run(syncCommand, environment);
run(["bd", "export", "--scrub", "-o", ".beads/issues.jsonl"], environment);
