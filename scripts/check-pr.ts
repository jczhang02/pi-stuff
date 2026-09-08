import { readFileSync } from "node:fs";

// Validate declarations only. Never execute or fetch PR-supplied text.
export const HEADINGS = [
  "Behavior and impact",
  "Approach and decisions",
  "Verification and reproduction",
  "Risk and review",
  "Related work",
] as const;
const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

function* linesWithFences(text: string): Generator<[string, boolean]> {
  let fence: string | undefined;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const marker = FENCE.exec(line);
    if (marker) {
      const run = marker[1]!;
      if (!fence) fence = run;
      else if (run[0] === fence[0] && run.length >= fence.length && !marker[2]!.trim()) fence = undefined;
      yield [line, true];
    } else yield [line, fence !== undefined];
  }
}

function substantive(text: string): boolean {
  for (let line of text.split(/\r\n|\r|\n/)) {
    if (FENCE.test(line) || /^#{1,6}[ \t]+/.test(line)) continue;
    line = line.replace(/^\s*(?:[-*]\s+(?:\[[ xX]\]\s*)?)?/, "").trim();
    if (!line || /^[^\p{L}\p{N}]+$/u.test(line)) continue;
    if (/^[\p{L}\p{N}_ /-]+:\s*$/u.test(line)) continue;
    if (/^(?:N\/?A|none|TODO|TBD|not applicable)[.!]?$/i.test(line)) continue;
    return true;
  }
  return false;
}

export function checkBody(input: unknown): string[] {
  if (typeof input !== "string") return ["PR body must be text"];
  // Template comments are guidance, not submitted evidence.
  const body = input.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  const sections = new Map<string, string[]>();
  const errors: string[] = [];
  let current: string | undefined;
  for (const [line, fenced] of linesWithFences(body)) {
    const heading = fenced ? null : /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (heading && heading[1]!.length <= 3) {
      current = heading[1]!.length === 3 ? heading[2]! : undefined;
      if (current !== undefined) {
        if (sections.has(current)) errors.push("duplicate PR section");
        sections.set(current, []);
      }
    } else if (current !== undefined) sections.get(current)!.push(line);
  }
  for (const heading of HEADINGS) {
    if (!substantive((sections.get(heading) ?? []).join("\n"))) {
      errors.push(`missing or empty section: ${heading}`);
    }
  }
  const review = [...linesWithFences((sections.get("Risk and review") ?? []).join("\n"))]
    .filter(([, fenced]) => !fenced).map(([line]) => line).join("\n");
  const declarations = [...review.matchAll(/^(Risk level|Independent review|Review evidence):[ \t]*([^\n]*)$/gm)];
  const values = new Map<string, string>();
  for (const field of ["Risk level", "Independent review", "Review evidence"]) {
    const matches = declarations.map((match, index) => ({ match, index })).filter(({ match }) => match[1] === field);
    if (matches.length !== 1) errors.push(`include exactly one ${field} field`);
    else {
      const { match, index } = matches[0]!;
      const end = declarations[index + 1]?.index ?? review.length;
      const start = match.index + match[0].length - match[2]!.length;
      values.set(field, (field === "Review evidence" ? review.slice(start, end) : match[2]!).trim());
    }
  }
  const risk = values.get("Risk level") ?? "";
  const status = values.get("Independent review") ?? "";
  if (!["low", "high"].includes(risk)) errors.push("Risk level must be low or high");
  if (!["completed", "not-required", "waived"].includes(status)) {
    errors.push("ready PRs need completed, not-required, or waived independent review");
  }
  if (risk === "high" && !["completed", "waived"].includes(status)) {
    errors.push("high-risk PRs need completed review or an explicitly authorized waiver");
  }
  if (!substantive(values.get("Review evidence") ?? "")) {
    errors.push("Review evidence must explain the review, exemption, or authorized waiver");
  }
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function checkEvent(event: unknown): string[] {
  if (!isRecord(event) || !isRecord(event.pull_request)) return ["event must contain a pull_request object"];
  const pr = event.pull_request;
  if (typeof pr.draft !== "boolean") return ["pull_request.draft must be a boolean"];
  return pr.draft ? [] : checkBody(pr.body);
}

function readUtf8(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

export function main(args = process.argv.slice(2)): number {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    console.log("Usage: bun scripts/check-pr.ts [--body-file <path>]");
    return 0;
  }
  if (args.length && (args.length !== 2 || args[0] !== "--body-file")) {
    console.error("Usage: bun scripts/check-pr.ts [--body-file <path>]");
    return 2;
  }
  let errors: string[];
  try {
    if (args[0] === "--body-file") errors = checkBody(readUtf8(args[1]!));
    else if (process.env.GITHUB_EVENT_NAME === "pull_request") {
      const eventPath = process.env.GITHUB_EVENT_PATH;
      if (!eventPath) throw new Error("missing event path");
      errors = checkEvent(JSON.parse(readUtf8(eventPath)));
    } else {
      console.log("PR evidence: not applicable to this event.");
      return 0;
    }
  } catch (error) {
    // Do not echo arbitrary payloads or credential-bearing paths.
    console.error(`Cannot read PR evidence input (${error instanceof SyntaxError ? "SyntaxError" : "InputError"}).`);
    return 1;
  }
  if (errors.length) {
    console.error(errors.join("\n"));
    return 1;
  }
  console.log("PR evidence structure passed (or PR is draft); claims still require review.");
  return 0;
}

if (import.meta.main) process.exitCode = main();
