import { parseDocument } from "yaml";

export function asRecord(value: unknown, message = "expected a mapping"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

export function loadYaml(text: string): unknown {
  // YAML 1.2 keeps `on` a string. Reject duplicates rather than silently keeping the last value.
  const document = parseDocument(text, { version: "1.2", uniqueKeys: true });
  const problems = [...document.errors, ...document.warnings];
  if (problems.length) throw new Error(problems.map(error => error.message).join("; "));
  return document.toJS({ maxAliasCount: 100 });
}

export function loadJson(text: string): unknown {
  // JSON.parse validates JSON syntax but accepts duplicate keys. YAML's JSON schema detects them.
  const value: unknown = JSON.parse(text);
  const document = parseDocument(text, { schema: "json", uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors.map(error => error.message).join("; "));
  return value;
}
