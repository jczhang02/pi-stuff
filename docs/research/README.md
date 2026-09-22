# UI research index

[简体中文](../i18n/zh-CN/research/README.md) · [UI spec](../ui-spec.md)

Start with the UI spec to review the design. Use the table below to trace a rule to its evidence.

| Question                                                                                        | Evidence                                                       |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [Which conversation outputs exist?](conversation-coverage-2026-09-20.md)                        | Product cd0f174, Pi 0.85.1                                     |
| [What can be reused from the old UI and other packages?](ui-sources.md)                         | Old Pi Stuff, Pi APIs, Codex, OpenCode, Gemini and Pi packages |
| [Where does ⎿ appear, and how many times?](claude-code-result-marker-2026-09-21.md)             | 20 runs, 43 states                                             |
| [Which calls group, and what breaks a group?](claude-code-tool-folding-2026-09-21.md)           | 14 runs, 28 states                                             |
| [How could disclosure, running titles and diffs improve?](claude-code-ui-details-2026-09-22.md) | 16 runs, 35 states                                             |

## Reading the evidence

The three Claude reports use the official 2.1.261 client with fixed local SSE responses. Tools execute, but model selection is not tested. Other harness and package findings refer to their pinned source revisions. The UI spec lists proposals still awaiting adoption.
