# Session naming

[简体中文](i18n/zh-CN/session-naming.md) · English is normative.

Pi Stuff names a fresh foreground TUI session after its first successful exchange. It makes one attempt and leaves that name alone on later turns. A cancelled, failed or ambiguous opening leaves the session unnamed until you choose a name yourself.

Use Pi's native `/name Exact title` for a direct assignment. `/autoname` generates a replacement from the opening request and recent dialogue; `/autoname Document OAuth migration risks` gives the model a task hint with priority over that dialogue. Accepting `/autoname` permanently ends automation for that session, including when generation fails. A newer command supersedes a pending request.

Generation has no progress notice and succeeds silently by updating the native session name. Errors use Pi's native chat-area notification. If the name has not reached storage, the only success-related notice is `Name not saved yet.`. Print/JSON commands wait for completion and send feedback to stderr, leaving JSON stdout machine-readable. Automatic requests run quietly in the background. A pending result cannot overwrite a later direct rename, navigation or another generation. Names belong to the whole session, including its branches.

## Naming panel

Open `/naming` in a TUI to see the current name, generate a replacement or change settings. Generation accepts an optional task hint and applies the result immediately. If neither dialogue text nor a hint exists, it asks for a hint without calling the model. Back/close cancels an unfinished request started by the panel; an applied name is kept.

Settings save individually and take effect immediately:

- **Automatic naming** enables or disables opening naming. Enabling it does not rearm the current session.
- **Naming model** searches Pi's authenticated models without changing the conversation model. Choose `Use current session model` to remove the override. An existing unavailable override remains inspectable; generation still fails without a fallback.
- **Naming rules** edits the full prompt in Pi's multiline editor. `Use default` restores the built-in English rules.
- **Maximum length** accepts a positive integer. `Use default` restores 80 code points.
- **Restore defaults** confirms a reset of naming settings while keeping the current name.

A committed configuration change cancels older naming requests without retrying. A failed save keeps the active settings and any pending request. External file edits are not overwritten: use `/reload` before retrying. Confirmed settings are durable; Esc abandons unsubmitted text, not a save already started.

The panel uses Pi's theme, native selection and input bindings. Esc always goes back or closes, including under remapped cancel bindings. Long names and model identifiers have `[` / `]` pages. The minimum size is 56 columns by 24 rows; smaller terminals show a resize notice with an exit action. Both Naming and RTK reuse the existing local contrast correction for Pi's built-in light palette, without changing custom themes.

## Configuration

Add `naming` to the existing `pi-stuff.json` in Pi's agent directory, then use `/reload`. Omitted fields use their defaults:

```json
{
  "naming": {
    "automatic": true,
    "model": {"provider": "openai-codex", "id": "gpt-6-astra"},
    "maxLength": 80
  }
}
```

`model` is optional. Without it, each request uses the current session model. With it, Pi resolves that exact provider/model and its existing authentication; an unavailable model or credential fails without selecting a fallback. The example is not a cost recommendation.

Set `automatic` to `false` to keep generation manual, through `/autoname` or the panel. `prompt` replaces the naming style guidance, so another language or format is supported. For example:

```json
{
  "naming": {
    "automatic": false,
    "prompt": "用中文简洁描述当前主任务, 保留技术标识符, 不写进度.",
    "maxLength": 40
  }
}
```

The default style is English `type: Action object`, with `research`, `feat`, `fix`, `refactor`, `docs` or `chore`. It prefers 4-8 description words, preserves identifier casing and omits dates, scope parentheses and progress. For example: `research: Compare OAuth provider compatibility`. This is model guidance, not a semantic guarantee. The user's request takes precedence over an assistant misunderstanding even with a custom style.

`maxLength` is an independent positive integer counted in Unicode code points. Empty, multiline, control-containing and overlong outputs fail without truncation or a repair call. Blank prompts/model identifiers and invalid configuration use the package's existing configuration diagnostic. File edits apply after `/reload`; panel saves apply immediately. Neither path renames or rearms existing sessions.

## Eligibility and persistence

Automatic naming supports regular/fullscreen TUI sessions with a fresh native session file, no prior dialogue/name and no parent link. It skips resume, import, reload, forks, existing empty files, nonpersistent sessions and RPC/JSON/print launches. A separate queued request makes the opening ambiguous and skips automation. Internal tool continuations remain part of the first exchange.

There is no universal child flag in Pi's extension API. A third-party launcher that disguises a child as an ordinary foreground TUI must disable automatic naming; that launch shape is not supported.

Pi can keep the name of a blank session only in memory until an assistant exchange causes normal persistence. The command reports `Name not saved yet.` and the panel shows `Not saved yet`, with an explanation that the first assistant reply saves it. Exiting immediately can lose the name; completing an exchange preserves it. With `--no-session`, storage is disabled and the name stays temporary even after a reply; the panel explains that distinction. Pi Stuff does not force a history write or maintain a separate name database.

## Request limits

Automatic input contains the raw opening request and final visible assistant answer, capped at 2,000 code points. Explicit input is capped at 4,000. A supplied hint takes that budget; without one, selection retains opening intent and recent user/assistant text. Long text keeps both ends with an omission marker. Tools, thinking, images, process messages and loaded skill instructions are excluded. Assistant text may quote excluded material, so role filtering is not a secrecy guarantee.

Every attempt has a 15-second local deadline, one generation call, no extension retry/fallback and no additional summarizer or classifier. Cancellation affects naming only. Client retries are disabled where supported; output budget is `min(model.maxTokens, 1024, max(64, 2 × maxLength))`, normally 160 tokens. The style prompt and framing are outside conversation limits. Tokenization, provider-required reasoning and transport behavior prevent an exact universal billing cap.

The Pi 0.85.1 API mapping requests SSE, `maxRetries: 0` and a finite `maxTokens`. OpenAI completions/responses use the adapter's default thinking-off mapping; Anthropic receives `thinkingEnabled: false`; Google receives `thinking.enabled: false` (Gemini 3 uses its minimum supported thinking level); Codex requests no reasoning when supported and minimal otherwise. Providers may ignore output/retry controls: the inspected Codex Responses adapter does not serialize `maxTokens` into its request body. These are bounded local controls, not a promise that all providers consume the same tokens. Abort cannot recover tokens already used remotely.

Tests use real isolated Pi commands, lifecycle events and native session files with a controlled HTTP model. See [issue #108](https://github.com/jczhang02/pi-stuff/issues/108) for specification, runtime acceptance, recorded model examples and review evidence.

## Acceptance evidence (2026-09-22)

The runtime checks use Linux, Bun 1.4.0, Pi 0.85.1 from the pinned dependency and the maintainer's compiled Pi 0.87.0 (runtime-reported Bun 1.4.0). Terminal Control 1.2.1 drives real regular/fullscreen sessions with isolated settings, session files and working directories. The controlled model verifies request counts, errors, deadlines, navigation races, forks, reload/restart, preflight failure and compaction queue replay. A readonly session file and Linux `/dev/full` exercise native write failures. The extension preflights known unwritable files; an unexpected failure during Pi's write can leave the displayed name changed but unsaved. The extension tells the user to fix file access and restart with that session before continuing. It does not append a compensating rename: Pi advances its in-memory history before writing, so a second write could persist a broken parent link. Recovery checks reopen the repaired file and verify its existing messages and parent chain.

Run offline checks with `bun run check` and `bun run test`. To repeat compiled-host naming acceptance, set `PI_TEST_HOST` to the compiled executable and run `bun test tests/system/naming*.test.ts`. Live account tests are separate from this offline suite.

The following eight names came from actual `openai-codex/gpt-6-astra` requests through the compiled host with the final prompt, using synthetic conversations. Six opening requests completed in 2.7-6.0 seconds as observed in the terminal (including observation overhead). Token usage and billing were not measured. An earlier prompt produced one missing colon; the default now states the exact separator explicitly. This small sample supports relevance, identifier preservation and style, not a statistical reliability claim.

| Input intent                                                                    | Generated name                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Research OAuth compatibility; assistant incorrectly claims implementation       | `research: Compare existing providers for OAuth compatibility`         |
| Implement Pi naming, including tests/docs; assistant discusses initial research | `feat: Add configurable Pi auto session naming extension`              |
| Fix duplicate payment callbacks                                                 | `fix: Prevent double charges from duplicate payment callbacks`         |
| Refactor RTK without behavior changes                                           | `refactor: Restructure RTK command rewriting without behavior changes` |
| Write Exa key setup/troubleshooting docs                                        | `docs: Document Exa API key setup and troubleshooting`                 |
| Update pinned Bun and lockfile                                                  | `chore: Update pinned Bun version and regenerate lockfile`             |
| `/autoname` after the agreed task changes to OAuth risk documentation           | `docs: Document OAuth migration risks only`                            |
| `/autoname Fix session rename races in Pi` overrides earlier dialogue           | `fix: Resolve session rename races in Pi`                              |

The panel tests cover field saves and resets, multiline rules, invalid length, stale-file refusal, committed-save cancellation, panel cancellation, remapped keys, persistence status refresh and long-value pagination. The captures below were taken from compiled Pi 0.87.0 with a controlled local model, using real commands at 100×30 and 56×24. Their displayed title is fixture output; the live-model samples above are separate evidence.

The light terminal uses black/white default foreground/background; dark uses light text on black. Exports explicitly use `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. These are headless terminal captures, not native window/compositor evidence.

![Dark naming panel after applying a temporary name](assets/session-naming/panel-dark.png)

![Light naming settings panel](assets/session-naming/panel-light.png)

![Model selection at the minimum 56×24 size](assets/session-naming/panel-narrow.png)
