import {access, constants, realpath, stat} from 'node:fs/promises';
import {delimiter, isAbsolute, resolve} from 'node:path';
import {Effect, Schema} from 'effect';
import {
  RtkProcessError,
  RTK_PROCESS_TIMEOUT_MS,
  runRtkProcess,
  type RtkProcessResult,
} from './process';
import type {RtkSettings} from './settings';

export type RtkResolutionSource = 'custom' | 'PATH' | 'mise';

export interface RtkProbeResult {
  path: string;
  version: string;
  source: RtkResolutionSource;
}

export class RtkRuntimeError extends Schema.TaggedError<RtkRuntimeError>()(
  'RtkRuntimeError',
  {
    kind: Schema.Literals(['aborted', 'invalid', 'timeout', 'unavailable']),
    message: Schema.String,
  },
) {}

type CachedProbe =
  | {kind: 'success'; result: RtkProbeResult}
  | {kind: 'failure'; error: RtkRuntimeError};

const VERSION = /\brtk(?:\s+|\/)(\d+(?:\.\d+)+(?:[-+][A-Za-z0-9.-]+)?)/i;

function processError(error: Error): RtkRuntimeError {
  if (Schema.is(RtkRuntimeError)(error)) return error;
  if (Schema.is(RtkProcessError)(error))
    return new RtkRuntimeError({
      kind:
        error.kind === 'aborted'
          ? 'aborted'
          : error.kind === 'timeout'
            ? 'timeout'
            : 'unavailable',
      message: error.message,
    });
  return new RtkRuntimeError({
    kind: 'unavailable',
    message: error.message || 'RTK runtime discovery failed.',
  });
}

function isAborted(error: Error, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  if (Schema.is(RtkRuntimeError)(error)) return error.kind === 'aborted';
  return Schema.is(RtkProcessError)(error) && error.kind === 'aborted';
}

async function usableExecutable(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(
  name: string,
  cwd: string,
): Promise<string | undefined> {
  const entries = process.env.PATH?.split(delimiter) ?? [];
  for (const entry of entries) {
    const candidate = resolve(cwd, entry || '.', name);
    if (!(await usableExecutable(candidate))) continue;
    try {
      return await realpath(candidate);
    } catch {
      // A candidate can disappear between stat/access and realpath.
    }
  }
  return undefined;
}

function ensureNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw new RtkRuntimeError({
      kind: 'aborted',
      message: 'RTK runtime operation was cancelled.',
    });
}

async function validatedPath(
  candidate: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  ensureNotAborted(signal);
  if (!candidate || !isAbsolute(candidate))
    throw new RtkRuntimeError({
      kind: 'invalid',
      message: 'RTK executable must be an absolute path.',
    });
  if (!(await usableExecutable(candidate)))
    throw new RtkRuntimeError({
      kind: 'invalid',
      message: `RTK executable is missing or not executable: ${candidate}`,
    });
  ensureNotAborted(signal);
  try {
    return await realpath(candidate);
  } catch {
    throw new RtkRuntimeError({
      kind: 'invalid',
      message: `RTK executable could not be resolved: ${candidate}`,
    });
  }
}

async function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<RtkProcessResult> {
  try {
    return await Effect.runPromise(
      runRtkProcess(executable, args, cwd, signal, RTK_PROCESS_TIMEOUT_MS),
    );
  } catch (error) {
    throw processError(
      error instanceof Error ? error : new Error('RTK process failed.'),
    );
  }
}

async function probePath(
  candidate: string,
  cwd: string,
  source: RtkResolutionSource,
  signal: AbortSignal | undefined,
): Promise<RtkProbeResult> {
  const path = await validatedPath(candidate, signal);
  const result = await runProcess(path, ['--version'], cwd, signal);
  ensureNotAborted(signal);
  const version = VERSION.exec(result.stdout)?.[1];
  if (result.code !== 0 || !version)
    throw new RtkRuntimeError({
      kind: 'invalid',
      message: `RTK executable did not report a valid version: ${path}`,
    });
  return {path, version, source};
}

async function probeMise(
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<RtkProbeResult> {
  const mise = await findOnPath('mise', cwd);
  if (!mise)
    throw new RtkRuntimeError({
      kind: 'unavailable',
      message: 'RTK was not found on PATH and mise is unavailable.',
    });
  const result = await runProcess(mise, ['which', 'rtk'], cwd, signal);
  ensureNotAborted(signal);
  if (result.code !== 0)
    throw new RtkRuntimeError({
      kind: 'unavailable',
      message: 'mise could not resolve an RTK executable.',
    });
  const candidate = result.stdout
    .split(/\r?\n/u)
    .map(line => line.trim())
    .find(line => isAbsolute(line));
  if (!candidate)
    throw new RtkRuntimeError({
      kind: 'unavailable',
      message: 'mise did not return an absolute RTK executable path.',
    });
  return probePath(candidate, cwd, 'mise', signal);
}

export function isRtkCancellation(error: Error): boolean {
  return (
    (Schema.is(RtkRuntimeError)(error) && error.kind === 'aborted') ||
    (Schema.is(RtkProcessError)(error) && error.kind === 'aborted')
  );
}

export class RtkRuntime {
  private currentSettings: RtkSettings;
  private readonly cache = new Map<string, CachedProbe>();
  private generation = 0;
  private failure: string | undefined;

  constructor(settings: RtkSettings = {}) {
    this.currentSettings = {...settings};
  }

  get settings(): RtkSettings {
    return {...this.currentSettings};
  }

  get lastFailure(): string | undefined {
    return this.failure;
  }

  update(settings: RtkSettings): void {
    this.invalidate(settings);
  }

  invalidate(settings?: RtkSettings): void {
    this.generation++;
    if (settings !== undefined) this.currentSettings = {...settings};
    this.cache.clear();
    this.failure = undefined;
  }

  recordFailure(message: string): void {
    this.failure = message;
  }

  async probe(cwd: string, signal?: AbortSignal): Promise<RtkProbeResult> {
    ensureNotAborted(signal);
    const generation = this.generation;
    const key = `${cwd}\u0000${this.currentSettings.executable ?? ''}`;
    const cached = this.cache.get(key);
    if (cached?.kind === 'success') return cached.result;
    if (cached?.kind === 'failure') throw cached.error;
    try {
      let result: RtkProbeResult;
      const custom = this.currentSettings.executable;
      if (custom !== undefined) {
        result = await probePath(custom, cwd, 'custom', signal);
      } else {
        const pathCandidate = await findOnPath('rtk', cwd);
        if (pathCandidate) {
          try {
            result = await probePath(pathCandidate, cwd, 'PATH', signal);
          } catch (error) {
            const caught =
              error instanceof Error ? error : new Error('RTK process failed.');
            if (isAborted(caught, signal)) throw caught;
            result = await probeMise(cwd, signal);
          }
        } else {
          result = await probeMise(cwd, signal);
        }
      }
      ensureNotAborted(signal);
      if (generation === this.generation)
        this.cache.set(key, {kind: 'success', result});
      return result;
    } catch (error) {
      const runtimeError = processError(
        error instanceof Error ? error : new Error('RTK probe failed.'),
      );
      if (signal?.aborted)
        throw new RtkRuntimeError({
          kind: 'aborted',
          message: 'RTK runtime operation was cancelled.',
        });
      if (isAborted(runtimeError, undefined)) throw runtimeError;
      if (generation === this.generation)
        this.cache.set(key, {kind: 'failure', error: runtimeError});
      throw runtimeError;
    }
  }

  async execute(
    args: string[],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<RtkProcessResult> {
    const resolved = await this.probe(cwd, signal);
    try {
      const result = await runProcess(resolved.path, args, cwd, signal);
      ensureNotAborted(signal);
      return result;
    } catch (error) {
      const runtimeError = processError(
        error instanceof Error ? error : new Error('RTK process failed.'),
      );
      throw runtimeError;
    }
  }
}
