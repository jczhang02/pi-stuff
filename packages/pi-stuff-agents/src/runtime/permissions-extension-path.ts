import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PERMISSIONS_PACKAGE_NAME = "@jczhang02/pi-stuff-permissions";
const AGENTS_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Resolve the owned Permissions extension from either a workspace/scoped sibling
 * or a dependency nested below the Agents package. This avoids runtime-specific
 * bare-specifier resolution, which is not stable when Pi loads TypeScript source
 * packages through Jiti.
 */
export function resolvePermissionsExtensionPath(agentsPackageRoot = AGENTS_PACKAGE_ROOT): string {
	const packageRoot = path.resolve(agentsPackageRoot);
	const candidates = [
		path.join(path.dirname(packageRoot), "pi-stuff-permissions"),
		path.join(packageRoot, "node_modules", "@jczhang02", "pi-stuff-permissions"),
	];
	const failures: string[] = [];

	for (const candidate of candidates) {
		const resolved = readPermissionsExtension(candidate);
		if (resolved.ok) return resolved.path;
		failures.push(resolved.reason);
	}

	throw new Error(
		`Cannot locate ${PERMISSIONS_PACKAGE_NAME} beside or below the Agents package. ${failures.join(" ")}`,
	);
}

type ExtensionResolution =
	| { readonly ok: true; readonly path: string }
	| { readonly ok: false; readonly reason: string };

function readPermissionsExtension(packageRoot: string): ExtensionResolution {
	const manifestPath = path.join(packageRoot, "package.json");
	let manifest: unknown;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch (error) {
		return { ok: false, reason: `${manifestPath}: ${errorMessage(error)}` };
	}

	if (!isRecord(manifest) || manifest.name !== PERMISSIONS_PACKAGE_NAME) {
		return { ok: false, reason: `${manifestPath}: unexpected Package identity.` };
	}
	const pi = isRecord(manifest.pi) ? manifest.pi : undefined;
	const extensions = Array.isArray(pi?.extensions) ? pi.extensions : [];
	const entry = extensions.find((value): value is string => typeof value === "string" && value.trim().length > 0);
	if (!entry) return { ok: false, reason: `${manifestPath}: missing Pi extension entry.` };

	const extensionPath = path.resolve(packageRoot, entry);
	const relative = path.relative(packageRoot, extensionPath);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		return { ok: false, reason: `${manifestPath}: Pi extension entry escapes its Package.` };
	}
	try {
		if (!fs.statSync(extensionPath).isFile()) {
			return { ok: false, reason: `${extensionPath}: extension entry is not a file.` };
		}
	} catch (error) {
		return { ok: false, reason: `${extensionPath}: ${errorMessage(error)}` };
	}
	return { ok: true, path: extensionPath };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
