import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { asRecord, loadJson, loadYaml } from "./parse";
import { splitLines } from "./text";

export { loadJson, loadYaml } from "./parse";

export function checkText(text: string): string[] {
  const errors: string[] = [];
  if (text.includes("\r")) errors.push("use LF line endings");
  if (text && !text.endsWith("\n")) errors.push("missing final newline");
  for (const [index, line] of splitLines(text).entries()) {
    if (line.trimEnd() !== line) errors.push(`line ${index + 1}: trailing whitespace`);
    if (line.includes("\t")) errors.push(`line ${index + 1}: use spaces, not tabs`);
  }
  return errors;
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function checkMarkdown(root: string, path: string, text: string): string[] {
  const errors: string[] = [];
  const prose: string[] = [];
  let fence: string | undefined;
  for (const [index, line] of splitLines(text).entries()) {
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      const run = marker[1]!;
      if (!fence) fence = run;
      else if (run[0] === fence[0] && run.length >= fence.length && !marker[2]!.trim()) fence = undefined;
      continue;
    }
    if (!fence) {
      if (/^#{1,6}[^#\s]/.test(line)) errors.push(`line ${index + 1}: add a space after heading markers`);
      prose.push(line);
    }
  }
  if (fence) errors.push("unclosed fenced code block");
  const body = prose.join("\n");
  // File targets only: this is not a full Markdown renderer or anchor checker.
  const links = [
    ...body.matchAll(/!?\[[^\]\n]*\]\(\s*<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g),
    ...body.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm),
    ...body.matchAll(/(?:href|src)=["']([^"']+)["']/g),
  ].map(match => match[1]!);
  const canonicalRoot = realpathSync(root);
  for (const link of links) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("//")) continue;
    const rawPath = link.split(/[?#]/, 1)[0]!;
    if (!rawPath) continue;
    let decoded: string;
    try { decoded = decodeURIComponent(rawPath); }
    catch { errors.push(`invalid local link encoding: ${link}`); continue; }
    const target = decoded.startsWith("/") ? resolve(root, decoded.slice(1)) : resolve(dirname(path), decoded);
    // Resolve existing symlinks too: a repository-local path must not point outside the repository.
    const canonicalTarget = existsSync(target) ? realpathSync(target) : target;
    if (!inside(canonicalRoot, canonicalTarget)) errors.push(`local link escapes the repository: ${link}`);
    else if (!existsSync(target)) errors.push(`missing local link target: ${link}`);
  }
  return errors;
}

export function checkLabels(value: unknown): Set<string> {
  if (!Array.isArray(value)) throw new Error("label manifest must be a list");
  const names = new Set<string>();
  for (const item of value) {
    const label = asRecord(item);
    if (typeof label.name !== "string" || !label.name || names.has(label.name.toLowerCase())) {
      throw new Error("invalid or duplicate label name");
    }
    // JavaScript lowercasing does not perform full Unicode case folding (for example, ß to ss).
    names.add(label.name.toLowerCase());
    if (typeof label.color !== "string" || !/^[0-9a-f]{6}$/i.test(label.color)) throw new Error(`invalid color for ${label.name}`);
    if (typeof label.description !== "string" || [...label.description].length > 100) throw new Error(`invalid description for ${label.name}`);
  }
  for (const name of ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"]) {
    if (!names.has(name)) throw new Error("missing canonical triage labels");
  }
  return names;
}

export function checkTemplate(text: string, labelNames: Set<string>): void {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("missing template frontmatter");
  const data = asRecord(loadYaml(match[1]!));
  for (const key of ["name", "about"]) {
    if (typeof data[key] !== "string" || !data[key].trim()) throw new Error(`missing template ${key}`);
  }
  if (!Array.isArray(data.labels) || data.labels.some(label => typeof label !== "string" || !labelNames.has(label))) {
    throw new Error("template labels must be a list of known labels");
  }
  if (!data.labels.includes("needs-triage")) throw new Error("new issues must have needs-triage");
}

function sameKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function readOnly(value: unknown): boolean {
  const permissions = asRecord(value, "CI must use contents: read");
  return sameKeys(permissions, ["contents"]) && permissions.contents === "read";
}

const PR_EVENTS = ["opened", "synchronize", "reopened", "edited", "ready_for_review", "converted_to_draft"];
const REQUIRED_COMMANDS = [
  "bun install --frozen-lockfile --ignore-scripts",
  "bun run typecheck",
  "bun run test",
  "bun run check:repo",
  "bun run check:pr",
];

export function checkWorkflow(value: unknown): void {
  const data = asRecord(value, "workflow must be a mapping");
  const events = asRecord(data.on, "CI must run on every pull request");
  if (!Object.hasOwn(events, "pull_request")) throw new Error("CI must run on every pull request");
  if (Object.keys(events).some(key => !["pull_request", "push", "workflow_dispatch"].includes(key))) {
    throw new Error("CI has an unexpected or privileged trigger");
  }
  const prEvents = asRecord(events.pull_request);
  if (!sameKeys(prEvents, ["types"])) throw new Error("required PR CI must declare evidence events without branch or path filters");
  if (!Array.isArray(prEvents.types) || prEvents.types.length !== PR_EVENTS.length || !PR_EVENTS.every(event => (prEvents.types as unknown[]).includes(event))) {
    throw new Error("PR CI must run for code/body updates and both draft/readiness transitions");
  }
  if (!readOnly(data.permissions)) throw new Error("CI must use contents: read");
  const jobs = asRecord(data.jobs, "CI must expose a checks job");
  const required = asRecord(jobs.checks, "CI must expose a checks job");
  if (required.name !== "checks" || "if" in required || "continue-on-error" in required) {
    throw new Error("required checks job must have a stable name and run unconditionally");
  }
  for (const item of Object.values(jobs)) {
    const job = asRecord(item);
    if (job["runs-on"] !== "ubuntu-24.04") throw new Error("CI must use the approved GitHub-hosted runner");
    const timeout = job["timeout-minutes"];
    if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > 30) {
      throw new Error("CI jobs need a timeout of 1-30 minutes");
    }
    if ("permissions" in job && !readOnly(job.permissions)) throw new Error("CI jobs must not expand token permissions");
    if (!Array.isArray(job.steps) || !job.steps.length) throw new Error("CI jobs need steps");
    const steps = job.steps.map(step => asRecord(step));
    if (job === required) {
      for (const command of REQUIRED_COMMANDS) {
        const matching = steps.filter(step => step.run === command);
        if (matching.length !== 1 || ["if", "continue-on-error", "env"].some(key => key in matching[0]!)) {
          throw new Error(`checks must run ${command} unconditionally without overrides`);
        }
      }
      const setup = steps.filter(step => typeof step.uses === "string" && step.uses.startsWith("oven-sh/setup-bun@"));
      if (setup.length !== 1 || !sameKeys(asRecord(setup[0]!.with), ["bun-version-file"]) || asRecord(setup[0]!.with)["bun-version-file"] !== "package.json") {
        throw new Error("CI must install the Bun version pinned in package.json");
      }
    }
    for (const step of steps) {
      const action = step.uses;
      if (action !== undefined && (typeof action !== "string" || !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(action))) {
        throw new Error("external actions must be pinned to a full commit SHA");
      }
      if (typeof action === "string" && action.startsWith("actions/checkout@")) {
        if (asRecord(step.with)["persist-credentials"] !== false) throw new Error("checkout must not persist credentials");
      }
    }
  }
}

export function checkToolchain(value: unknown): void {
  const data = asRecord(value);
  if (typeof data.packageManager !== "string" || !/^bun@\d+\.\d+\.\d+$/.test(data.packageManager)) {
    throw new Error("packageManager must pin an exact Bun version");
  }
  if (asRecord(data.engines).bun !== data.packageManager.slice(4)) throw new Error("engines.bun must match packageManager");
  const scripts = asRecord(data.scripts);
  const requiredScripts = {
    typecheck: "bun --bun tsc --noEmit",
    test: "bun test",
    "check:repo": "bun scripts/check-repo.ts",
    "check:pr": "bun scripts/check-pr.ts",
    check: "bun run typecheck && bun run test && bun run check:repo",
  };
  for (const [name, command] of Object.entries(requiredScripts)) {
    if (scripts[name] !== command) throw new Error(`script ${name} must run ${command}`);
  }
  for (const version of Object.values(asRecord(data.devDependencies))) {
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("direct tooling dependencies must use exact versions");
  }
}

export function checkPath(path: string): string[] {
  const parts = path.split(/[\\/]/);
  const name = parts.at(-1)!;
  if (parts.some(part => [".beads", ".worktrees", ".venv", "venv", "__pycache__", "node_modules"].includes(part)) || path.endsWith(".pyc") || name === ".DS_Store") {
    return ["generated or local-only path must not be tracked"];
  }
  if (name.startsWith(".env") && ![".env.example", ".env.sample"].includes(name)) return ["environment credential files must not be tracked"];
  return [];
}

export function checkRepo(root: string, paths: string[]): string[] {
  const errors: string[] = [];
  const labels = checkLabels(loadJson(readFileSync(resolve(root, ".github/labels.json"), "utf8")));
  const textSuffixes = new Set([".md", ".json", ".yml", ".yaml", ".ts", ".py", ".txt"]);
  const textNames = new Set([".gitignore", ".editorconfig", "bun.lock", "TEMPLATE_LICENSE", "LICENSE"]);
  for (const path of paths) {
    const fullPath = resolve(root, path);
    const problems = checkPath(path);
    try {
      if (textSuffixes.has(extname(path)) || textNames.has(path.split("/").at(-1)!)) {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(fullPath));
        problems.push(...checkText(text));
        if (path.endsWith(".md")) {
          problems.push(...checkMarkdown(root, fullPath, text));
          if (dirname(path) === ".github/ISSUE_TEMPLATE") checkTemplate(text, labels);
        } else if (path.endsWith(".json")) {
          const data = loadJson(text);
          if (path === "package.json") checkToolchain(data);
        } else if (/\.ya?ml$/.test(path)) {
          const data = loadYaml(text);
          if (path === ".github/workflows/ci.yml") checkWorkflow(data);
          else if (path === ".github/ISSUE_TEMPLATE/config.yml" && asRecord(data).blank_issues_enabled !== true) {
            throw new Error("keep blank issues available");
          }
        }
      }
    } catch (error) { problems.push(error instanceof Error ? error.message : "invalid file"); }
    errors.push(...problems.map(problem => `${path}: ${problem}`));
  }
  return errors;
}

export function main(): number {
  const root = resolve(import.meta.dir, "..");
  try {
    const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
    const errors = checkRepo(root, paths);
    if (errors.length) { console.error(errors.join("\n")); return 1; }
    console.log(`Repository checks passed (${paths.length} tracked files).`);
    return 0;
  } catch (error) { console.error(error instanceof Error ? error.message : "Repository check failed."); return 1; }
}

if (import.meta.main) process.exitCode = main();
