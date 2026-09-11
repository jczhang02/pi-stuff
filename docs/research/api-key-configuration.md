# API-key configuration for Pi Stuff

[简体中文](../i18n/zh-CN/research/api-key-configuration.md)

Checked 2026-09-11 for [#45](https://github.com/jczhang02/pi-stuff/issues/45). This is research and a design recommendation, **not an implemented or accepted configuration contract**. The current implementation reads Exa credentials only from `EXA_API_KEY`. No real credentials are included here.

## Conclusion

For this local extension, support a literal key in the existing global Pi Stuff configuration **and** retain an environment override. Requiring a launcher modification or separate secret file merely to use Exa adds unnecessary setup. A user-only plaintext file is a reasonable supported option, provided its limitations are explicit. Environment variables are not encrypted storage and are not automatically safer.

Proposed resolution: **nonblank `EXA_API_KEY` → `web.exaApiKey` → missing-key error**. This ordering is an application policy, not a universal SDK convention. It permits temporary/CI overrides without editing the saved configuration. A rejected credential must remain an authentication failure, not trigger a retry with another stored key.

Proposed example, currently unsupported:

```json
{
  "web": {
    "provider": "openai",
    "exaApiKey": "YOUR_EXA_API_KEY"
  }
}
```

Provider preference and credential availability are independent: keeping OpenAI preferred still lets Exa serve filtered searches and the existing eligible fallback cases. Whether to change that preference remains the user's choice.

## What other projects do

### OpenAI Python SDK

The ordinary constructor uses explicit `api_key` first, and reads `OPENAI_API_KEY` only when that argument is `None`. An explicit empty string does not fall back. Current source also accepts key callables, including async variants, so the application can supply a secret manager. These are separate from workload/provider identity modes, whose full chains were not audited. [Constructor](https://github.com/openai/openai-python/blob/d7c41efee1b0802b79f3f88a678ef2052b06e9ce/src/openai/_client.py#L161-L357), [request-time callable](https://github.com/openai/openai-python/blob/d7c41efee1b0802b79f3f88a678ef2052b06e9ce/src/openai/_client.py#L666-L692).

The README recommends python-dotenv for `.env` use. That is a separate loader, not automatic SDK application-config loading. **A constructor accepting a key does not prove that the SDK reads a config file.** [Official README](https://github.com/openai/openai-python/blob/d7c41efee1b0802b79f3f88a678ef2052b06e9ce/README.md).

### Exa JavaScript SDK

The constructor uses a truthy explicit `apiKey`, otherwise `process.env.EXA_API_KEY`, otherwise throws. Empty strings fall back; whitespace is not trimmed by that constructor. It places the result in `x-api-key`. This path has no config-file, `.env`, keychain or secret-command loader; an application must resolve such a source before passing a string. [Constructor](https://github.com/exa-labs/exa-js/blob/f33c4fffbcdded178b4d19b5ab259147d501b3b9/src/index.ts#L876-L920), [official usage](https://github.com/exa-labs/exa-js/blob/f33c4fffbcdded178b4d19b5ab259147d501b3b9/README.md).

Pi Stuff uses direct HTTP rather than this SDK. The relevant lesson is to keep credential resolution at the host/configuration boundary, not add an SDK just to read a string.

### GitHub CLI

`gh auth login` normally saves to the system credential store and falls back to plaintext when secure storage fails or is unavailable; `--insecure-storage` explicitly chooses plaintext. Tokens can also come from environment variables or stdin login. [Official login documentation](https://cli.github.com/manual/gh_auth_login), [login source](https://github.com/cli/cli/blob/8fcd6a643f993ee12b70ad0edeab741ed133c9f1/pkg/cmd/auth/login/login.go).

For active GitHub.com authentication, nonempty `GH_TOKEN` precedes `GITHUB_TOKEN`; then the resolver checks the host-level plaintext token before the active user's keyring token. Thus write preference for the keyring does not mean keyring-first reads. Enterprise host variables differ, and the separate per-user lookup has different ordering. Credentials use `hosts.yml`, distinct from general `config.yml`. [Active-token/storage code](https://github.com/cli/cli/blob/8fcd6a643f993ee12b70ad0edeab741ed133c9f1/internal/config/config.go#L254-L579), [actual go-gh v2.16.0 dependency resolver](https://github.com/cli/go-gh/blob/c9808f266122bea7f5d7500d771c8134a0217af7/pkg/auth/auth.go), [file loading](https://github.com/cli/go-gh/blob/c9808f266122bea7f5d7500d771c8134a0217af7/pkg/config/config.go).

### OpenAI Codex CLI

Codex supports `file`, `keyring`, `auto` and `ephemeral` credential storage. The inspected source default is **file**, not auto. File storage writes plaintext `CODEX_HOME/auth.json`, requesting `0600` on Unix creation. Auto tries the keyring and can fall back to a file; ephemeral is process memory. [Official authentication documentation](https://developers.openai.com/codex/auth), [storage implementation](https://github.com/openai/codex/blob/2fc4bda3ca3e93b764dd3845cb8c1a15a10866e1/codex-rs/login/src/auth/storage.rs), [storage-mode definitions](https://github.com/openai/codex/blob/2fc4bda3ca3e93b764dd3845cb8c1a15a10866e1/codex-rs/config/src/types.rs#L108-L160).

Custom providers can name an `env_key` or configure a literal `experimental_bearer_token`; required env-key absence is an error. Current code also supports a command-backed provider auth mechanism with timeout/refresh behavior and mutually exclusive settings. Managed ChatGPT/API-key authentication is a different, policy-dependent path: do **not** summarize Codex as simply `OPENAI_API_KEY → auth.json`. [Provider definitions](https://github.com/openai/codex/blob/2fc4bda3ca3e93b764dd3845cb8c1a15a10866e1/codex-rs/model-provider-info/src/lib.rs), [provider resolution](https://github.com/openai/codex/blob/2fc4bda3ca3e93b764dd3845cb8c1a15a10866e1/codex-rs/model-provider/src/auth.rs#L184-L305), [managed resolution](https://github.com/openai/codex/blob/2fc4bda3ca3e93b764dd3845cb8c1a15a10866e1/codex-rs/login/src/auth/manager.rs#L1461-L1569), [command implementation](https://github.com/openai/codex/blob/2fc4bda3ca3e93b764dd3845cb8c1a15a10866e1/codex-rs/login/src/auth/external_bearer.rs).

### Pi 0.85.1

Pi itself supports literal `models.json` API keys, environment interpolation and `!command` resolution. Its credential store also persists API-key/OAuth entries in the host-resolved `auth.json`. File creation requests mode `0600` and new parent directories `0700`; existing administrator-managed permissions/ACLs are preserved. Therefore file-backed credentials are already an intentional host capability, not intrinsically disallowed. [Version-pinned model documentation](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/models.md#value-resolution), [version-pinned auth storage](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/auth-storage.ts).

The installed model documentation was byte-for-byte identical to that tag's primary source. Installed credential-storage and model-registry APIs were also inspected. This does **not** establish a ready-made search-only Exa integration with Pi's login/provider registry. Do not register a fictitious chat model or bypass host ownership merely to obtain key storage. Direct reuse of the host credential facility would need a separate bounded compatibility check.

## Proposed boundaries

- Use only `<agent-dir>/pi-stuff.json`, outside the project checkout; retain the existing no-project-override policy. Add one optional literal field, not a second configuration hierarchy.
- When creating a file containing a key on Unix, use owner-only mode `0600`. Do not silently rewrite existing ACLs or permissions. Document that this is plaintext, not encryption.
- Never include the key or a dumped configuration in tool results, exceptions, diagnostics, committed examples or review evidence. At most report the credential source, not its value. Do not add a key-display tool.
- Treat a blank environment variable as absent. Validate an explicitly supplied file value; document precedence and fail clearly when no usable source exists. Keep existing authentication-error and provider-fallback semantics.
- Apply file changes through `/reload`, matching current configuration lifecycle. A changed parent-shell environment normally requires restarting Pi with the new environment; `/reload` cannot import it from another process.
- Owner-only files do not protect against the same user, root, arbitrary same-user agents or accidental backups. Environment variables can propagate to child processes and leak through diagnostic dumps. Neither is a sandbox boundary.
- Keychain or external secret-manager resolution can be useful when users need at-rest protection or centralized rotation. Prefer an existing supported host facility if one fits. Do not add native dependencies, encryption with a colocated key, a launcher change, or arbitrary command execution as a prerequisite for one Exa key.

These are recommendations awaiting confirmation. No runtime behavior, personal configuration, credentials or launcher was changed by this research. The earlier env-only #45 contract must be explicitly reconciled before implementation.

## Method and limits

A separate research session examined public OpenAI Python, Exa JS, GitHub CLI and Codex sources; the owner checked Pi's installed and version-pinned implementation. The ordinary constructors, relevant complete resolvers and storage paths were read, rather than inferring behavior from search hits. Repository links pin the inspected snapshots; official websites are unversioned and may change. This is not a comprehensive authentication/security audit. No provider-acceptance or credential-access test was performed for this research; prior Exa acceptance is separate evidence in [PR #46](https://github.com/jczhang02/pi-stuff/pull/46).
