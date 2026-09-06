import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u;
export const TEST_LEVELS = ["unit", "component-integration", "system", "system-integration", "acceptance"] as const;
export type TestLevel = (typeof TEST_LEVELS)[number];

export function discoverTestFiles(root: string): string[] {
	const files: string[] = [];
	function visit(directory: string): void {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && (TEST_FILE_PATTERN.test(entry.name) || entry.name.endsWith(".node.ts")))
				files.push(path);
		}
	}
	visit(root);
	return files.sort();
}

export function inventory(root = process.cwd()): string[] {
	return discoverTestFiles(resolve(root, "test")).map((path) => relative(root, path));
}

export function testLevel(file: string): TestLevel | undefined {
	const level = file.split("/")[1];
	return TEST_LEVELS.includes(level as TestLevel) ? (level as TestLevel) : undefined;
}

export function testCapability(file: string): string | undefined {
	return file.split("/")[2];
}

export function importsOf(root: string, file: string): string[] {
	try {
		const source = readFileSync(resolve(root, file), "utf8");
		return [...source.matchAll(/(?:from|import\s*\()\s*["']([^"']+)["']/gu)].flatMap((match) =>
			match[1] ? [match[1]] : [],
		);
	} catch {
		return [];
	}
}
