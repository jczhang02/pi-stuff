/**
 * MCP Auth Storage Module
 *
 * Handles secure storage of OAuth credentials, tokens, client information,
 * and legacy PKCE state for MCP servers.
 *
 * Persistent OAuth entries are stored in the operating system credential store.
 * Legacy plaintext entries are imported from $MCP_OAUTH_DIR/sha256-<server-hash>/tokens.json
 * when set, otherwise <Pi agent dir>/mcp-oauth/sha256-<server-hash>/tokens.json,
 * then the plaintext file is removed.
 */

import { isJsonInputObject, isJsonInputValue, parseJsonValue, type JsonInputObject, type JsonInputValue } from "../../shared/json-value.js";
import { isRuntimeBoolean, isRuntimeNumber } from "../../shared/runtime-type.js";
import { isRuntimeFunction, isRuntimeString } from "../../shared/runtime-type.js";
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { readFileSync, existsSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getAgentPath } from './agent-dir.ts';
import { resolveConfiguredOAuthDir } from './config.ts';

const require = createRequire(import.meta.url);
const AUTH_SECRET_SERVICE = 'pi-mcp-adapter.oauth';
const TEST_AUTH_STORE_ENV = 'PI_MCP_ADAPTER_TEST_AUTH_STORE';
const AUTH_SECRET_CHUNK_SIZE = 1800;
const KEYRING_RECOVERY_DISABLED_ENV = 'PI_MCP_ADAPTER_DISABLE_KEYRING_RECOVERY';
const KEYRING_RECOVERY_KEYCTL_ENV = 'PI_MCP_ADAPTER_KEYRING_RECOVERY_KEYCTL';
const KEYRING_RECOVERY_NODE_ENV = 'PI_MCP_ADAPTER_KEYRING_RECOVERY_NODE';
const KEYRING_RECOVERY_HELPER_ENV = 'PI_MCP_ADAPTER_KEYRING_RECOVERY_HELPER';
const TEST_LINUX_KEYRING_RECOVERY_ENV = 'PI_MCP_ADAPTER_TEST_LINUX_KEYRING_RECOVERY';
const KEYRING_RECOVERY_TIMEOUT_MS = 10_000;
const AUTH_CHUNK_MANIFEST_KEY = '__piMcpAdapterOAuthChunked';

type OAuthErrorInput = Error | JsonInputValue;

/** OAuth token storage format */
export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix timestamp in seconds
  scope?: string;
  /** SEP-2352 authorization-server issuer binding */
  issuer?: string;
}

/** OAuth client information from dynamic or static registration */
export interface StoredClientInfo {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
  redirectUris?: string[];
  /** SEP-2352 authorization-server issuer binding */
  issuer?: string;
  /**
   * True when this entry is a secretless SEP-2352 issuer stub persisted for a
   * config-pre-registered client (written by the config-clientId path of
   * saveClientInformation). Such a stub is only usable when paired with the
   * config that supplies the client secret; it must never be served as
   * standalone client information.
   */
  configPreRegistered?: boolean;
}

/** Complete auth entry for a server */
export interface AuthEntry {
  tokens?: StoredTokens;
  clientInfo?: StoredClientInfo;
  codeVerifier?: string;
  oauthState?: string;
  serverUrl?: string; // Track the URL these credentials are for
}

export interface AuthStorageOptions {
  /** Legacy plaintext import directory. Persistent secrets no longer use this as their store. */
  baseDir?: string;
}

export class OAuthCredentialStoreError extends Error {
  readonly code = 'OAUTH_CREDENTIAL_STORE_UNAVAILABLE';

	  constructor(
	    message: string,
	    readonly operation: 'read' | 'write' | 'remove',
	    cause: OAuthErrorInput,
  ) {
    super(message, { cause });
    this.name = 'OAuthCredentialStoreError';
  }
}

export type OAuthCredentialStatus =
  | { status: 'present'; entry: AuthEntry }
  | { status: 'absent' }
  | { status: 'unavailable'; message: string };

function causeChainContains(error: OAuthErrorInput, pattern: RegExp): boolean {
	  const seen = new Set<JsonInputObject>();
	  let current: OAuthErrorInput = error;
	  while (isJsonInputObject(current)) {
    if (seen.has(current)) break;
    seen.add(current);
	    const name = readObjectField(current, 'name');
	    const message = readObjectField(current, 'message');
	    const code = readObjectField(current, 'code');
	    if ([name, message, code].some(value => isRuntimeString(value) && pattern.test(value))) {
	      return true;
	    }
	    current = readObjectField(current, 'cause');
  }
  return false;
}

function readObjectField(value: JsonInputObject, key: string): JsonInputValue {
	const field = Object.getOwnPropertyDescriptor(value, key)?.value;
	return isJsonInputValue(field) ? field : undefined;
}

export function formatOAuthCredentialStoreUnavailable(error: OAuthCredentialStoreError): string {
  if (process.platform === 'linux' && causeChainContains(error, /key\s*(?:has been\s*)?revoked|keyrevoked/i)) {
    return 'OAuth credential store unavailable: the Linux session keyring may be revoked. Start Pi from a fresh login/keyring session and retry.';
  }
  return 'OAuth credential store unavailable. Configure or unlock the OS credential store and retry.';
}

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deleteCredential(): boolean;
}

type KeyringEntryConstructor = new (service: string, account: string) => KeyringEntry;
type KeyringModule = { Entry: KeyringEntryConstructor };
interface KeyringModuleExport {
	Entry?: JsonInputValue | KeyringEntryConstructor;
}
type KeyringRequire = ((id: string) => KeyringModuleExport) & { resolve(id: string): string };

interface AuthSecretStore {
  read(account: string): string | undefined;
  write(account: string, payload: string): void;
  remove(account: string): void;
}

interface AuthEntryChunkManifest {
  [AUTH_CHUNK_MANIFEST_KEY]: 1;
  chunkCount: number;
  chunkDigest: string;
}

let KeyringEntryClass: KeyringEntryConstructor | undefined;
const memoryAuthEntries = new Map<string, string>();

const memoryAuthSecretStore: AuthSecretStore = {
  read(account) {
    return memoryAuthEntries.get(account);
  },
  write(account, payload) {
    memoryAuthEntries.set(account, payload);
  },
  remove(account) {
    memoryAuthEntries.delete(account);
  },
};

const keyringAuthSecretStore: AuthSecretStore = {
  read(account) {
    return getKeyringEntry(account).getPassword() ?? undefined;
  },
  write(account, payload) {
    getKeyringEntry(account).setPassword(payload);
  },
  remove(account) {
    getKeyringEntry(account).deleteCredential();
  },
};

const unavailableAuthSecretStore: AuthSecretStore = {
  read() {
    throw new Error('simulated secure credential store unavailable');
  },
  write() {
    throw new Error('simulated secure credential store unavailable');
  },
  remove() {
    throw new Error('simulated secure credential store unavailable');
  },
};

function createKeyRevokedTestError(): Error {
  return new Error("Couldn't access platform storage: KeyRevoked", { cause: new Error('KeyRevoked') });
}

const keyRevokedAuthSecretStore: AuthSecretStore = {
  read() {
    throw createKeyRevokedTestError();
  },
  write() {
    throw createKeyRevokedTestError();
  },
  remove() {
    throw createKeyRevokedTestError();
  },
};

export function resetTestAuthSecretStore(): void {
  memoryAuthEntries.clear();
}

export function getTestAuthSecretStoreEntries(): [string, string][] {
  return [...memoryAuthEntries.entries()];
}

export function removeTestAuthSecretStoreEntry(account: string): void {
  memoryAuthEntries.delete(account);
}

function getAuthSecretStore(): AuthSecretStore {
  if (process.env[TEST_AUTH_STORE_ENV] === 'memory') return memoryAuthSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV] === 'unavailable') return unavailableAuthSecretStore;
  if (process.env[TEST_AUTH_STORE_ENV] === 'keyrevoked') return keyRevokedAuthSecretStore;
  return keyringAuthSecretStore;
}

function getKeyringEntry(account: string): KeyringEntry {
  try {
    KeyringEntryClass ??= loadKeyringEntryClass();
    return new KeyringEntryClass(AUTH_SECRET_SERVICE, account);
  } catch (error) {
    throw new Error('OAuth secure credential storage is unavailable. Configure the OS credential store and retry authentication.', { cause: error });
  }
}

function loadKeyringEntryClass(keyringRequire: KeyringRequire = require, platform: NodeJS.Platform = process.platform, arch: NodeJS.Architecture = process.arch): KeyringEntryConstructor {
  try {
	    return parseKeyringModule(keyringRequire('@napi-rs/keyring')).Entry;
  } catch (loaderError) {
    try {
      return loadKeyringNativeBindingFallback(keyringRequire, platform, arch).Entry;
    } catch (fallbackError) {
      throw new Error(`Failed to load @napi-rs/keyring; absolute-path native binding fallback also failed: ${formatErrorMessage(fallbackError)}`, {
        cause: loaderError,
      });
    }
  }
}

function loadKeyringNativeBindingFallback(keyringRequire: KeyringRequire, platform: NodeJS.Platform, arch: NodeJS.Architecture): KeyringModule {
  const targets = getKeyringNativeBindingTargets(platform, arch);
  if (targets.length === 0) {
    throw new Error(`Unsupported @napi-rs/keyring native binding target: ${platform}-${arch}`);
  }

  let lastError: Error | undefined;
  for (const target of targets) {
    try {
      const packageJsonPath = keyringRequire.resolve(`${target.packageName}/package.json`);
	      return parseKeyringModule(keyringRequire(join(dirname(packageJsonPath), target.bindingFile)));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Failed to load the keyring native binding");
}

function parseKeyringModule(value: KeyringModuleExport): KeyringModule {
	if (!isRuntimeFunction(value.Entry)) throw new Error('Keyring native binding did not export Entry');
	return { Entry: value.Entry };
}

function getKeyringNativeBindingTargets(platform: NodeJS.Platform, arch: NodeJS.Architecture): { packageName: string; bindingFile: string }[] {
  return getKeyringNativeBindingSuffixes(platform, arch).map(suffix => ({
    packageName: `@napi-rs/keyring-${suffix}`,
    bindingFile: `keyring.${suffix}.node`,
  }));
}

function getKeyringNativeBindingSuffixes(platform: NodeJS.Platform, arch: NodeJS.Architecture): string[] {
  if (platform === 'darwin') {
    if (arch === 'arm64') return ['darwin-arm64'];
    if (arch === 'x64') return ['darwin-x64'];
  }
  if (platform === 'win32') {
    if (arch === 'arm64') return ['win32-arm64-msvc'];
    if (arch === 'x64') return ['win32-x64-msvc'];
    if (arch === 'ia32') return ['win32-ia32-msvc'];
  }
  if (platform === 'linux') {
    if (arch === 'arm64') return ['linux-arm64-gnu', 'linux-arm64-musl'];
    if (arch === 'arm') return ['linux-arm-gnueabihf'];
    if (arch === 'riscv64') return ['linux-riscv64-gnu'];
    if (arch === 'x64') return ['linux-x64-gnu', 'linux-x64-musl'];
  }
  if (platform === 'freebsd' && arch === 'x64') return ['freebsd-x64'];
  return [];
}

function formatErrorMessage(error: OAuthErrorInput): string {
  return error instanceof Error ? error.message : String(error);
}

type KeyringRecoveryOperation = 'read' | 'write' | 'remove';

type KeyringRecoveryResponse =
  | { ok: true; found?: boolean; value?: string }
  | { ok: false; error?: string };

function isLinuxKeyringRecoveryEnabled(): boolean {
  if (process.env[KEYRING_RECOVERY_DISABLED_ENV] === '1') return false;
  return process.platform === 'linux' || process.env[TEST_LINUX_KEYRING_RECOVERY_ENV] === '1';
}

function shouldAttemptLinuxKeyringRecovery(error: OAuthErrorInput): boolean {
  return isLinuxKeyringRecoveryEnabled()
    && causeChainContains(error, /key\s*(?:has been\s*)?revoked|keyrevoked/i);
}

function runLinuxKeyringRecoveryOperation(operation: KeyringRecoveryOperation, account: string, payload?: string): KeyringRecoveryResponse {
  const keyctl = process.env[KEYRING_RECOVERY_KEYCTL_ENV]?.trim() || 'keyctl';
  const node = process.env[KEYRING_RECOVERY_NODE_ENV]?.trim() || 'node';
  const helper = process.env[KEYRING_RECOVERY_HELPER_ENV]?.trim()
    || fileURLToPath(new URL('./mcp-keyring-helper.cjs', import.meta.url));
  const request = JSON.stringify({ operation, service: AUTH_SECRET_SERVICE, account, payload });
  const result = spawnSync(keyctl, ['session', '-', node, helper], {
    input: `${request}\n`,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: KEYRING_RECOVERY_TIMEOUT_MS,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`Linux keyring recovery helper could not start: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`Linux keyring recovery helper failed with exit code ${result.status ?? 'unknown'}`);
  }

	  let response: JsonInputValue;
  try {
	    response = parseJsonValue(result.stdout.trim());
  } catch (error) {
    throw new Error('Linux keyring recovery helper returned invalid JSON', { cause: error });
  }
	  if (!isJsonInputObject(response) || !isRuntimeBoolean(response.ok)) {
	    throw new Error('Linux keyring recovery helper returned an invalid response');
	  }
	  const responseError = isRuntimeString(response.error) ? response.error : undefined;
	  if (response.ok === false) {
	    if (response.error !== undefined && responseError === undefined) {
	      throw new Error('Linux keyring recovery helper returned an invalid error response');
	    }
	    throw new Error(responseError || 'Linux keyring recovery helper failed');
	  }
	  if (response.found !== undefined && !isRuntimeBoolean(response.found)) {
	    throw new Error('Linux keyring recovery helper returned an invalid found flag');
	  }
	  if (response.value !== undefined && !isRuntimeString(response.value)) {
	    throw new Error('Linux keyring recovery helper returned an invalid read response');
	  }
	  if (operation === 'read' && response.found === true && response.value === undefined) {
	    throw new Error('Linux keyring recovery helper returned an invalid read response');
	  }
	  const recovery: KeyringRecoveryResponse = { ok: true };
	  const found = isRuntimeBoolean(response.found) ? response.found : undefined;
	  const value = isRuntimeString(response.value) ? response.value : undefined;
	  if (found !== undefined) recovery.found = found;
	  if (value !== undefined) recovery.value = value;
	  return recovery;
}

const linuxKeyringRecoveryAuthSecretStore: AuthSecretStore = {
  read(account) {
    const response = runLinuxKeyringRecoveryOperation('read', account);
    return response.ok && response.found === true ? response.value : undefined;
  },
  write(account, payload) {
    runLinuxKeyringRecoveryOperation('write', account, payload);
  },
  remove(account) {
    runLinuxKeyringRecoveryOperation('remove', account);
  },
};

export function loadTestKeyringEntryClass(keyringRequire: KeyringRequire, platform: NodeJS.Platform, arch: NodeJS.Architecture): KeyringEntryConstructor {
  return loadKeyringEntryClass(keyringRequire, platform, arch);
}

export function getAuthStorageOptions(oauthDir: JsonInputValue, cwd = process.cwd()): AuthStorageOptions {
  const baseDir = resolveConfiguredOAuthDir(oauthDir, cwd);
  return baseDir ? { baseDir } : {};
}

export function getAuthBaseDir(options: AuthStorageOptions = {}): string {
  const override = process.env.MCP_OAUTH_DIR?.trim();
  if (override) return override;
  return options.baseDir ?? getAgentPath('mcp-oauth');
}

/**
 * Get the legacy server-specific directory path.
 */
function getServerDir(serverName: string, options?: AuthStorageOptions): string {
  if (!isRuntimeString(serverName)) {
    throw new Error(`Invalid MCP server name: ${JSON.stringify(serverName)}`);
  }
  const storageKey = getAuthEntryAccount(serverName);
  return join(getAuthBaseDir(options), storageKey);
}

function getAuthEntryAccount(serverName: string): string {
  if (!isRuntimeString(serverName)) {
    throw new Error(`Invalid MCP server name: ${JSON.stringify(serverName)}`);
  }
  return `sha256-${createHash('sha256').update(serverName, 'utf8').digest('hex')}`;
}

/**
 * Get the legacy plaintext tokens file path for a server.
 */
export function getAuthEntryFilePath(serverName: string, options?: AuthStorageOptions): string {
  return join(getServerDir(serverName, options), 'tokens.json');
}

function parseJsonPayload(serverName: string, payload: string, source: string): JsonInputValue {
  try {
	    return parseJsonValue(payload);
  } catch (error) {
    throw new Error(`Failed to parse OAuth credentials for ${serverName} from ${source}`, { cause: error });
  }
}

function parseAuthEntryPayload(serverName: string, payload: string, source: string): AuthEntry {
	  const value = parseJsonPayload(serverName, payload, source);
	  if (!isJsonInputObject(value)) throw new Error(`Invalid OAuth credentials for ${serverName} from ${source}`);
	  const entry: AuthEntry = {};
	  if (value.tokens !== undefined) entry.tokens = parseStoredTokens(value.tokens, serverName, source);
	  if (value.clientInfo !== undefined) entry.clientInfo = parseStoredClientInfo(value.clientInfo, serverName, source);
	  assignOptionalString(entry, 'codeVerifier', value.codeVerifier, serverName, source);
	  assignOptionalString(entry, 'oauthState', value.oauthState, serverName, source);
	  assignOptionalString(entry, 'serverUrl', value.serverUrl, serverName, source);
	  return entry;
}

function parseStoredTokens(value: JsonInputValue, serverName: string, source: string): StoredTokens {
	const record = requireAuthObject(value, 'tokens', serverName, source);
	if (!isRuntimeString(record.accessToken)) throw invalidAuthField('tokens.accessToken', serverName, source);
	const tokens: StoredTokens = { accessToken: record.accessToken };
	assignOptionalString(tokens, 'refreshToken', record.refreshToken, serverName, source);
	assignOptionalNumber(tokens, 'expiresAt', record.expiresAt, serverName, source);
	assignOptionalString(tokens, 'scope', record.scope, serverName, source);
	assignOptionalString(tokens, 'issuer', record.issuer, serverName, source);
	return tokens;
}

function parseStoredClientInfo(value: JsonInputValue, serverName: string, source: string): StoredClientInfo {
	const record = requireAuthObject(value, 'clientInfo', serverName, source);
	if (!isRuntimeString(record.clientId)) throw invalidAuthField('clientInfo.clientId', serverName, source);
	const info: StoredClientInfo = { clientId: record.clientId };
	assignOptionalString(info, 'clientSecret', record.clientSecret, serverName, source);
	assignOptionalNumber(info, 'clientIdIssuedAt', record.clientIdIssuedAt, serverName, source);
	assignOptionalNumber(info, 'clientSecretExpiresAt', record.clientSecretExpiresAt, serverName, source);
	assignOptionalString(info, 'issuer', record.issuer, serverName, source);
	if (record.redirectUris !== undefined) {
		if (!Array.isArray(record.redirectUris) || !record.redirectUris.every(isRuntimeString)) {
			throw invalidAuthField('clientInfo.redirectUris', serverName, source);
		}
		info.redirectUris = record.redirectUris;
	}
	if (record.configPreRegistered !== undefined) {
		if (!isRuntimeBoolean(record.configPreRegistered)) throw invalidAuthField('clientInfo.configPreRegistered', serverName, source);
		info.configPreRegistered = record.configPreRegistered;
	}
	return info;
}

function requireAuthObject(value: JsonInputValue, field: string, serverName: string, source: string): JsonInputObject {
	if (!isJsonInputObject(value)) throw invalidAuthField(field, serverName, source);
	return value;
}

function invalidAuthField(field: string, serverName: string, source: string): Error {
	return new Error(`Invalid OAuth credential field ${field} for ${serverName} from ${source}`);
}

function assignOptionalString<Target extends object, Key extends keyof Target>(
	target: Target,
	key: Key,
	value: JsonInputValue,
	serverName: string,
	source: string,
): void {
	if (value === undefined) return;
	if (!isRuntimeString(value)) throw invalidAuthField(String(key), serverName, source);
	Object.assign(target, { [key]: value });
}

function assignOptionalNumber<Target extends object, Key extends keyof Target>(
	target: Target,
	key: Key,
	value: JsonInputValue,
	serverName: string,
	source: string,
): void {
	if (value === undefined) return;
	if (!isRuntimeNumber(value) || !Number.isFinite(value)) throw invalidAuthField(String(key), serverName, source);
	Object.assign(target, { [key]: value });
}

function isAuthEntryChunkManifest<Value>(value: Value): value is Value & AuthEntryChunkManifest {
	  if (!isJsonInputObject(value)) return false;
	  return value[AUTH_CHUNK_MANIFEST_KEY] === 1
	    && isRuntimeNumber(value.chunkCount)
	    && Number.isInteger(value.chunkCount)
	    && value.chunkCount > 0
	    && isRuntimeString(value.chunkDigest)
	    && /^[a-f0-9]{16}$/.test(value.chunkDigest);
}

function getAuthEntryChunkAccount(account: string, manifest: AuthEntryChunkManifest, index: number): string {
  return `${account}.chunk.${manifest.chunkDigest}.${index}`;
}

function getAuthEntryChunkAccounts(account: string, manifest: AuthEntryChunkManifest): string[] {
  return Array.from({ length: manifest.chunkCount }, (_, index) => getAuthEntryChunkAccount(account, manifest, index));
}

function readChunkManifestFromPayload(serverName: string, payload: string, source: string): AuthEntryChunkManifest | undefined {
  const parsed = parseJsonPayload(serverName, payload, source);
  return isAuthEntryChunkManifest(parsed) ? parsed : undefined;
}

function readExistingChunkManifest(store: AuthSecretStore, serverName: string, account: string): AuthEntryChunkManifest | undefined {
  try {
    const payload = store.read(account);
    return payload === undefined ? undefined : readChunkManifestFromPayload(serverName, payload, 'OS secure credential store');
  } catch {
    return undefined;
  }
}

function removeChunkPayloads(store: AuthSecretStore, account: string, manifest: AuthEntryChunkManifest): void {
  for (const chunkAccount of getAuthEntryChunkAccounts(account, manifest)) {
    store.remove(chunkAccount);
  }
}

function tryRemoveChunkPayloads(store: AuthSecretStore, account: string, manifest: AuthEntryChunkManifest | undefined): void {
  if (!manifest) return;
  try {
    removeChunkPayloads(store, account, manifest);
  } catch {
    // Stale chunk cleanup must not hide a successful credential write.
  }
}

function createChunkManifest(payload: string): AuthEntryChunkManifest {
  return {
    [AUTH_CHUNK_MANIFEST_KEY]: 1,
    chunkCount: Math.ceil(payload.length / AUTH_SECRET_CHUNK_SIZE),
    chunkDigest: createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16),
  };
}

function readChunkedAuthEntry(store: AuthSecretStore, serverName: string, account: string, manifest: AuthEntryChunkManifest): AuthEntry {
  const chunks = getAuthEntryChunkAccounts(account, manifest).map((chunkAccount) => {
    try {
      const chunk = store.read(chunkAccount);
      if (chunk === undefined) {
        throw new Error(`Missing OAuth credential chunk ${chunkAccount} for ${serverName}`);
      }
      return chunk;
    } catch (error) {
      throw new OAuthCredentialStoreError(
        `Failed to read OAuth credentials for ${serverName} from the OS secure credential store`,
        'read',
        error,
      );
    }
  });
  return parseAuthEntryPayload(serverName, chunks.join(''), 'OS secure credential store chunks');
}

function readLegacyAuthEntry(serverName: string, options?: AuthStorageOptions): AuthEntry | undefined {
  const filePath = getAuthEntryFilePath(serverName, options);
  if (!existsSync(filePath)) return undefined;
  const data = readFileSync(filePath, 'utf-8');
  return parseAuthEntryPayload(serverName, data, filePath);
}

function removeLegacyAuthEntry(serverName: string, options?: AuthStorageOptions): void {
  const filePath = getAuthEntryFilePath(serverName, options);
  if (!existsSync(filePath)) return;
  try {
    rmSync(filePath, { force: true });
  } catch (error) {
    throw new Error(`Failed to remove legacy plaintext OAuth credentials for ${serverName} at ${filePath}`, { cause: error });
  }

  const dir = getServerDir(serverName, options);
  try {
    rmSync(dir, { recursive: true });
  } catch {
    // Directory may contain future non-secret metadata; the plaintext file was already removed.
  }
}

function writeSecureAuthEntryToStore(store: AuthSecretStore, serverName: string, entry: AuthEntry): void {
  const account = getAuthEntryAccount(serverName);
  const payload = JSON.stringify(entry);
  const previousManifest = readExistingChunkManifest(store, serverName, account);
  const manifest = payload.length > AUTH_SECRET_CHUNK_SIZE ? createChunkManifest(payload) : undefined;

  try {
    if (manifest) {
      for (let index = 0; index < manifest.chunkCount; index++) {
        const chunk = payload.slice(index * AUTH_SECRET_CHUNK_SIZE, (index + 1) * AUTH_SECRET_CHUNK_SIZE);
        store.write(getAuthEntryChunkAccount(account, manifest, index), chunk);
      }
      store.write(account, JSON.stringify(manifest));
    } else {
      // Compact: multiline secrets corrupt gnome-keyring plaintext (GKeyFile) collections.
      store.write(account, payload);
    }
    if (previousManifest?.chunkDigest !== manifest?.chunkDigest) {
      tryRemoveChunkPayloads(store, account, previousManifest);
    }
  } catch (error) {
    tryRemoveChunkPayloads(store, account, manifest);
    throw new OAuthCredentialStoreError(
      `Failed to write OAuth credentials for ${serverName} to the OS secure credential store`,
      'write',
      error,
    );
  }
}

function writeSecureAuthEntry(serverName: string, entry: AuthEntry): void {
  try {
    writeSecureAuthEntryToStore(getAuthSecretStore(), serverName, entry);
  } catch (error) {
    if (!shouldAttemptLinuxKeyringRecovery(error)) throw error;
    writeSecureAuthEntryToStore(linuxKeyringRecoveryAuthSecretStore, serverName, entry);
  }
}

/**
 * Read the auth entry for a server from the OS secure store, importing and
 * deleting a legacy plaintext entry when present.
 */
function readAuthEntryFromStore(
  store: AuthSecretStore,
  serverName: string,
  options?: AuthStorageOptions,
  behavior: { migrateLegacy?: boolean } = {},
): AuthEntry | undefined {
  const account = getAuthEntryAccount(serverName);
  let payload: string | undefined;
  try {
    payload = store.read(account);
  } catch (error) {
    throw new OAuthCredentialStoreError(
      `Failed to read OAuth credentials for ${serverName} from the OS secure credential store`,
      'read',
      error,
    );
  }

  if (payload !== undefined) {
    const manifest = readChunkManifestFromPayload(serverName, payload, 'OS secure credential store');
    const entry = manifest
      ? readChunkedAuthEntry(store, serverName, account, manifest)
      : parseAuthEntryPayload(serverName, payload, 'OS secure credential store');
    removeLegacyAuthEntry(serverName, options);
    return entry;
  }

  const legacyEntry = readLegacyAuthEntry(serverName, options);
  if (!legacyEntry) return undefined;
  if (behavior.migrateLegacy === false) return legacyEntry;
  writeSecureAuthEntryToStore(store, serverName, legacyEntry);
  removeLegacyAuthEntry(serverName, options);
  return legacyEntry;
}

function readAuthEntry(
  serverName: string,
  options?: AuthStorageOptions,
  behavior: { migrateLegacy?: boolean } = {},
): AuthEntry | undefined {
  try {
    return readAuthEntryFromStore(getAuthSecretStore(), serverName, options, behavior);
  } catch (error) {
    if (!shouldAttemptLinuxKeyringRecovery(error)) throw error;
    return readAuthEntryFromStore(linuxKeyringRecoveryAuthSecretStore, serverName, options, behavior);
  }
}

/**
 * Get auth entry for a server.
 */
export function getAuthEntry(serverName: string, options?: AuthStorageOptions): AuthEntry | undefined {
  return readAuthEntry(serverName, options);
}

/**
 * Get auth entry and validate it's for the correct URL.
 * Returns undefined if URL has changed (credentials are invalid).
 */
export function getAuthForUrl(serverName: string, serverUrl: string, options?: AuthStorageOptions): AuthEntry | undefined {
  const entry = getAuthEntry(serverName, options);
  if (!entry) return undefined;

  // If no serverUrl is stored, this is from an old version - consider it invalid
  if (!entry.serverUrl) return undefined;

  // If URL has changed, credentials are invalid
  if (entry.serverUrl !== serverUrl) return undefined;

  return entry;
}

/**
 * Inspect credentials for status-only UI paths without treating an unavailable
 * secure store as missing credentials. Authentication operations continue to
 * use getAuthForUrl() directly and therefore remain fail-closed.
 */
export function inspectAuthForUrl(
  serverName: string,
  serverUrl: string,
  options?: AuthStorageOptions,
): OAuthCredentialStatus {
  try {
    const entry = readAuthEntry(serverName, options, { migrateLegacy: false });
    if (!entry?.serverUrl || entry.serverUrl !== serverUrl) return { status: 'absent' };
    return { status: 'present', entry };
  } catch (error) {
    if (!(error instanceof OAuthCredentialStoreError)) throw error;
    return { status: 'unavailable', message: formatOAuthCredentialStoreUnavailable(error) };
  }
}

/**
 * Save auth entry for a server.
 */
export function saveAuthEntry(serverName: string, entry: AuthEntry, serverUrl?: string, options?: AuthStorageOptions): void {
  // Always update serverUrl if provided
  if (serverUrl) {
    entry.serverUrl = serverUrl;
  }
  writeSecureAuthEntry(serverName, entry);
  removeLegacyAuthEntry(serverName, options);
}

/**
 * Remove auth entry for a server.
 */
function removeAuthEntryFromStore(store: AuthSecretStore, serverName: string): void {
  const account = getAuthEntryAccount(serverName);
  try {
    const payload = store.read(account);
    const manifest = payload === undefined ? undefined : readChunkManifestFromPayload(serverName, payload, 'OS secure credential store');
    if (manifest) removeChunkPayloads(store, account, manifest);
    store.remove(account);
  } catch (error) {
    throw new OAuthCredentialStoreError(
      `Failed to remove OAuth credentials for ${serverName} from the OS secure credential store`,
      'remove',
      error,
    );
  }
}

export function removeAuthEntry(serverName: string, options?: AuthStorageOptions): void {
  try {
    removeAuthEntryFromStore(getAuthSecretStore(), serverName);
  } catch (error) {
    if (!shouldAttemptLinuxKeyringRecovery(error)) throw error;
    removeAuthEntryFromStore(linuxKeyringRecoveryAuthSecretStore, serverName);
  }
  removeLegacyAuthEntry(serverName, options);
}

/**
 * Update tokens for a server.
 */
export function updateTokens(
  serverName: string,
  tokens: StoredTokens,
  serverUrl?: string,
  options?: AuthStorageOptions
): void {
  const entry = getAuthEntry(serverName, options) ?? {};
  if (serverUrl && entry.serverUrl !== serverUrl) {
    delete entry.clientInfo;
    delete entry.codeVerifier;
    delete entry.oauthState;
  }
  entry.tokens = tokens;
  saveAuthEntry(serverName, entry, serverUrl, options);
}

/**
 * Update client info for a server.
 */
export function updateClientInfo(
  serverName: string,
  clientInfo: StoredClientInfo,
  serverUrl?: string,
  options?: AuthStorageOptions
): void {
  const entry = getAuthEntry(serverName, options) ?? {};
  if (serverUrl && entry.serverUrl !== serverUrl) {
    delete entry.tokens;
    delete entry.codeVerifier;
    delete entry.oauthState;
  }
  entry.clientInfo = clientInfo;
  saveAuthEntry(serverName, entry, serverUrl, options);
}

/**
 * Update code verifier for a server.
 */
export function updateCodeVerifier(serverName: string, codeVerifier: string, serverUrl?: string, options?: AuthStorageOptions): void {
  const entry = getAuthEntry(serverName, options) ?? {};
  if (serverUrl && entry.serverUrl !== serverUrl) {
    delete entry.tokens;
    delete entry.clientInfo;
    delete entry.oauthState;
  }
  entry.codeVerifier = codeVerifier;
  saveAuthEntry(serverName, entry, serverUrl, options);
}

/**
 * Clear code verifier for a server.
 */
export function clearCodeVerifier(serverName: string, options?: AuthStorageOptions): void {
  const entry = getAuthEntry(serverName, options);
  if (entry) {
    delete entry.codeVerifier;
    saveAuthEntry(serverName, entry, undefined, options);
  }
}

/**
 * Update OAuth state for a server.
 */
export function updateOAuthState(serverName: string, state: string, serverUrl?: string, options?: AuthStorageOptions): void {
  const entry = getAuthEntry(serverName, options) ?? {};
  if (serverUrl && entry.serverUrl !== serverUrl) {
    delete entry.tokens;
    delete entry.clientInfo;
    delete entry.codeVerifier;
  }
  entry.oauthState = state;
  saveAuthEntry(serverName, entry, serverUrl, options);
}

/**
 * Get OAuth state for a server.
 */
export function getOAuthState(serverName: string, options?: AuthStorageOptions): string | undefined {
  const entry = getAuthEntry(serverName, options);
  return entry?.oauthState;
}

/**
 * Clear OAuth state for a server.
 */
export function clearOAuthState(serverName: string, options?: AuthStorageOptions): void {
  const entry = getAuthEntry(serverName, options);
  if (entry) {
    delete entry.oauthState;
    saveAuthEntry(serverName, entry, undefined, options);
  }
}

/**
 * Check if stored tokens are expired.
 * Returns null if no tokens exist, false if no expiry or not expired, true if expired.
 */
export function isTokenExpired(serverName: string, options?: AuthStorageOptions): boolean | null {
  const entry = getAuthEntry(serverName, options);
  if (!entry?.tokens) return null;
  if (!entry.tokens.expiresAt) return false;
  return entry.tokens.expiresAt < Date.now() / 1000;
}

/**
 * Check if a server has stored tokens.
 */
export function hasStoredTokens(serverName: string, options?: AuthStorageOptions): boolean {
  const entry = getAuthEntry(serverName, options);
  return !!entry?.tokens;
}

/**
 * Clear all credentials for a server.
 */
export function clearAllCredentials(serverName: string, options?: AuthStorageOptions): void {
  removeAuthEntry(serverName, options);
}

/**
 * Clear only client info for a server.
 */
export function clearClientInfo(serverName: string, options?: AuthStorageOptions): void {
  const entry = getAuthEntry(serverName, options);
  if (entry) {
    delete entry.clientInfo;
    saveAuthEntry(serverName, entry, undefined, options);
  }
}

/**
 * Clear only tokens for a server.
 */
export function clearTokens(serverName: string, options?: AuthStorageOptions): void {
  const entry = getAuthEntry(serverName, options);
  if (entry) {
    delete entry.tokens;
    saveAuthEntry(serverName, entry, undefined, options);
  }
}
