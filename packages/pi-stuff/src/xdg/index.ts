import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

type XdgEnvironment = Readonly<Record<string, string | undefined>>;

function absoluteEnvironmentPath(name: keyof XdgEnvironment, environment: XdgEnvironment): string | undefined {
	const value = environment[name];
	return value && isAbsolute(value) ? value : undefined;
}

export function xdgConfigHome(environment: XdgEnvironment = process.env, home = homedir()): string {
	return absoluteEnvironmentPath("XDG_CONFIG_HOME", environment) ?? join(home, ".config");
}

export function xdgStateHome(environment: XdgEnvironment = process.env, home = homedir()): string {
	return absoluteEnvironmentPath("XDG_STATE_HOME", environment) ?? join(home, ".local", "state");
}

export function xdgCacheHome(environment: XdgEnvironment = process.env, home = homedir()): string {
	return absoluteEnvironmentPath("XDG_CACHE_HOME", environment) ?? join(home, ".cache");
}

export function xdgRuntimeHome(environment: XdgEnvironment = process.env): string | undefined {
	return absoluteEnvironmentPath("XDG_RUNTIME_DIR", environment);
}

export function piStuffCachePath(...segments: string[]): string {
	return join(xdgCacheHome(), "pi-stuff", ...segments);
}

export function piStuffStatePath(...segments: string[]): string {
	return join(xdgStateHome(), "pi-stuff", ...segments);
}
