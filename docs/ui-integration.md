# UI integration experiments

[简体中文](i18n/zh-CN/ui-integration.md) · English is normative.

These experiments examine gaps between Pi's extension API and the accepted UI. The maintainer has [approved the assistant/Thoughts display adaptation](https://github.com/jczhang02/pi-stuff/issues/106#issuecomment-5786103200). The first implementation adds the assistant gutter; Thoughts typography and timing remain unfinished. Tool-history integration must first compare public-API early registration with the lookup patch, as [decided separately](https://github.com/jczhang02/pi-stuff/issues/106#issuecomment-5785970338).

## Assistant and Thoughts: public API limits

The assistant experiment ran on the installed compiled Pi 0.87.0 / Bun 1.4.0, with an isolated deterministic provider and a 100×45 Terminal Control session. Production baseline: `5accad3`.

The experiment registered a Markdown transformer that prepended `• ` to assistant text and `• Thoughts: ` to thinking. It also exposed Pi's `setHiddenThinkingLabel` through a temporary command.

| Operation                                                                                      | Observed result                                                                                 | Consequence                                                  |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Prefix a response beginning with two Markdown list items                                       | The first line becomes `• - FIRST_LIST_ITEM`; the second marker remains two columns to its left | Source prefixing does not supply the accepted message gutter |
| Prefix visible thinking                                                                        | The entire Thoughts row remains italic; the captured frame contained 35 italic cells            | The prefix does not change Pi's default thinking typography  |
| Set the hidden label to `• Thoughts · 1s`, create another response, then set `• Thoughts · 2s` | Both historical thinking blocks display `2s`                                                    | A global label cannot represent independent durations        |

The `1s` and `2s` strings are deliberately assigned labels, not measured durations. The provider received the original prior assistant text without the display prefix.

![Public transformer experiment: list alignment and italic Thoughts](assets/ui/public-api-prefix-dark-100.png)

![Global label experiment: both history blocks acquire the latest label](assets/ui/public-api-labels-dark-100.png)

Pi's [extension types](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/types.ts) expose the transformer before Markdown rendering and a string-valued hidden label. The [assistant component](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/modes/interactive/components/assistant-message.ts) applies italic thinking styles and owns local visibility overrides. There is no registered assistant-component factory in that extension API. The installed 0.85.1 declarations have the same relevant boundary.

### Behavior to preserve

The real-host message test checks that Ctrl+T changes the default and clears local overrides, clicking reveals only one thinking block, and Ctrl+O leaves thinking hidden. It also checks that the next model request contains the original assistant text. These are passing preservation checks; they do not establish the new typography or timing.

```sh
bun test tests/system/ui-messages.test.ts
PI_TEST_HOST=/opt/bin/pi bun test tests/system/ui-messages.test.ts
```

The deterministic provider sends reasoning before the final text. Only the provider stream is scripted; the tests drive the actual Pi TUI and its renderer. Welcome coverage remains in the same file.

### Approved compatibility boundary

The approved boundary is a display-only adapter around `AssistantMessageComponent` content assembly. Approval covers this integration approach, not completion or performance acceptance.

- Add the assistant gutter after Markdown parsing. Keep Pi's Markdown renderer, code highlighting, wrapping and native failure/Esc presentation.
- Adapt each Thoughts block's presentation and measured in-memory duration. Preserve Hide thinking, Ctrl+T and local mouse disclosure. Do not modify canonical messages, provider context or saved sessions; omit unavailable historical durations.
- Install once per active UI extension and restore on shutdown/reload. Check the supported host shape, preserve other extensions and fall back to native rendering when the adapter cannot apply safely. Do not change Pi installation files.
- Verify repeated reload, session replacement, theme/width changes, streaming, list/code-first responses and long-history performance before acceptance.

Using the global hidden-label setter as a timer would also repeatedly update historical components. Mutating saved thinking to add labels, as the [inspected pi-tool-display revision](https://github.com/MasuRii/pi-tool-display/blob/91cef7580078371f8dc49a8607222807ad6a424d/src/thinking-label.ts) does, conflicts with the agreed record-preservation requirement. Neither approach is selected.

### Assistant gutter implementation

The first slice wraps native content assembly, identifies the owning runtime through its registered identity Markdown transformer, and adds a two-column gutter to native Markdown children. It leaves Thoughts mouse regions and native error Text components alone. It does not prepend text to messages or replace Markdown parsing. Quit/reload disables the wrapper before restoring it when still owned; session replacement keeps it installed.

The wrapper reuses the native rendered-line array and keeps one width of prefixed output. Independent review caught repeated ANSI scanning in the initial version; it now recomputes only when native lines or width change. Full streaming and long-history performance acceptance remains pending.

Real-host tests cover list-first answers, reload, dark/light theme changes, 60/80/120 columns, repeated UI enable/disable and new sessions, plus the original thinking disclosure checks. They also check that the next provider request receives the original list text. These tests do not establish Thoughts styling, timing, concurrent SDK isolation or arbitrary external patch coexistence.

This compiled Pi 0.87.0 / Bun 1.4.0 capture uses an isolated deterministic provider, 80×24 cells and Pi's dark theme. Terminal Control exported the virtual terminal as SVG, then rsvg-convert produced the PNG. It is not a Ghostty-window screenshot.

![Assistant gutter with native list and code rendering](assets/ui/assistant-gutter-dark-80.png)

The tool experiment below remains a candidate alongside early public-API registration.

## Tool definitions before history reconstruction

On 2026-09-22, an isolated probe intercepted the exported `AgentSession.getToolDefinition()` method in Pi 0.85.1 and the installed compiled Pi 0.87.0, both running Bun 1.4.0. The extension returned every definition unchanged. Both hosts queried historical tool definitions **before** emitting `session_start` on reload and resume. Each returned definition included its real `execute`, parameter schema and renderers. The current product registers its built-in replacements in `session_start`, after those history components have been assembled.

The inspected [AgentSession source](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts) exposes this lookup publicly. The [interactive mode](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts) uses it when constructing tool components. Intercepting the method is still a compatibility patch, not a supported renderer-registration API.

Two further throwaway experiments used the existing isolated Pi-host fixture and Terminal Control 1.2.1. The product UI was disabled in those runs; the temporary extension owned only the experimental display adaptation. The production baseline was `12b0969`. [Retained observations](assets/ui/tool-lookup-experiment.json) include both hosts' lifecycle traces and terminal text.

| Experiment                                                                                                     | Observed on both hosts                                                                                                                                                                                                | Limit                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Copy a native Read definition and replace only its renderer slots                                              | Live display, three reloads and resume use the candidate renderer; recorded content survives a later file change                                                                                                      | This does not validate all built-in tools                                                                                         |
| Register custom Grep and Find fixtures, preserving Grep and explicitly opting Find into the candidate renderer | Grep keeps its custom rendering; Find uses the candidate; provider results remain the fixture's original results                                                                                                      | These are third-party-shaped fixtures, not acceptance of installed third-party packages                                           |
| Compare definitions and session data                                                                           | Returned `execute`, schema and prompt fields retain their original references; the observed existing session file stays byte-identical through reload/new/resume; reload/resume do not execute the custom tools again | This is not a complete UI-enabled/disabled equivalence test; cancellation and SDK execution overrides still need production tests |
| Reuse the unchanged product Read renderer and retrieval index                                                  | Two successful Reads group before a failed Read; the following success starts a new group. The failure stays visible. The same boundaries survive three reloads and resume                                            | Only Read without explicit offset/limit was tested; Web grouping and other lifecycle transitions remain untested here             |
| Open the restored group and use Ctrl+O                                                                         | Members align with ordinary tools; compact members hide their body; expansion reveals recorded content, including after the file changes                                                                              | This is functional evidence, not a long-history performance result                                                                |

History grouping needs one additional step. The temporary adapter retained the native `context.invalidate()` callback for results assembled before `session_start`. After the existing retrieval index restored its branch, it called each retained callback once and cleared the callback map. Pi then reran the result renderer against the restored index. This required no change to `ToolExecutionComponent` or the product retrieval implementation. Calling `setToolsExpanded()` with its current value is not an alternative: the inspected host returns without refreshing.

### Scope and export checks

A lifecycle-callback identity check passed on 0.85.1 but failed on compiled 0.87.0: its extension loader wraps event handlers in `registeredHandler`. Checking only the loaded extension's `resolvedPath` then passed both hosts, but independent review rejected it as sufficient ownership evidence: simultaneous SDK instances may load the same path.

Command handlers preserve their original identity on both hosts. The final grouping experiment uses that identity to match the owning loaded extension. A separate probe created two real SDK sessions with the same inline-extension name in each host; each query reached only its own adapter. Production can use the already registered `/ui` handler for this purpose, without adding a marker command. These probes establish runtime ownership, not complete concurrent SDK UI or configuration acceptance.

Review also caught a teardown problem: restoring only while at the top of a patch chain allows another extension to reinstall a stale wrapper later. The revised experiment first makes its wrapper inactive and transparent, then restores the original only if it still owns the method. The SDK probe checked both teardown orders and an intervening external wrapper. An inactive adapter stayed inactive when that external wrapper restored it, and the other live adapter kept working. Repeated foreign-wrapper churn, retained memory and actual third-party patch packages still need testing.

HTML export also uses the definition lookup. The 0.85.1 export retained the original session results and used the simple custom Grep/Find renderers; its embedded session data was decoded and checked. Read uses Pi's own HTML template, so this does not validate custom Read HTML or the product retrieval-group export. An initial assertion searched the HTML source directly and failed because Pi base64-encodes that data. This was an experiment error, not a product defect. Compiled 0.87.0 could not export because its installed `export-html/template.css` was missing. The same failure occurred without the interception. Export compatibility on that installation remains unverified; no installation files were changed.

### Tool integration comparison

Compare early public-API registration, as used by pi-tool-display, with the following tool-definition adapter. Neither is selected. Preserve the same execution, ownership, Web configuration, lifecycle and performance requirements for both; prefer the simpler public route if it meets them. The lookup candidate would work as follows: Identify the owning runtime by its `/ui` command handler, decorate the actual definition before native history construction, preserve execution and schema, and refresh only pre-start result components after the group index is ready. Keep third-party renderers by default and use the same boundary for explicit takeover. Disable the adapter during teardown before attempting restoration; do not overwrite another extension's replacement.

Pi Stuff's Web definitions are also currently registered in `session_start`; this lookup cannot decorate a definition that is still absent. Earlier registration through Pi's public API must preserve authentication, model selection and invalid-configuration behavior. Before production acceptance, integrate all tool families and Bash outcome observation, and rerun the existing failing history tests plus configuration, cancellation, media, lifecycle and patch-coexistence coverage. Measure the complete long-history workload with the adapter enabled and disabled. The two product reload/resume failures remain unresolved at `12b0969`; successful temporary experiments do not turn them into passing production tests. The comparison must establish whether this patch is needed before selecting the production approach.
