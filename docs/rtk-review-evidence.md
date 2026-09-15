# RTK UI review evidence

[中文](i18n/zh-CN/rtk-review-evidence.md)

The UI repair after `99b7edf59aec91a692742e5e7ae9d3f055b97bd7` addresses the five findings below. The original captures are retained as before-state evidence, not accepted designs.

Environment: Linux, compiled Pi 0.85.1, Bun 1.4.0, RTK 0.45.0, Pi dark palette, and `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. PNGs are Terminal Control exports from real Pi sessions, not desktop-window screenshots or redrawn mockups. Configuration, HOME and statistics were isolated. In the previous repair, History used actual native RTK records; failure and delayed-error cases used controlled process fixtures. The follow-up data sources are specified below. A still image does not prove a keypress; the reproduction traces below describe the observed interaction.

## Compact short pages

The follow-up after `ab0f97f` removes the shared 22-row minimum. In the compiled Pi capture, the root menu is 15 rows, Settings is 18 rows at 100 columns and 19 at 56 columns, while Usage and Diagnostics retain their 22-row report budget. Executable editing uses a compact page with one fixed feedback row. Root summary and Settings description slots reserve only the space needed for same-page updates. Full errors remain in Pi notifications.

The final batch covers root, Settings and Usage in both built-in themes at 100x30 and 56x26, 12 states. Configuration and statistics are isolated fixtures. The first narrow export captured the cropped pre-resize frame; the final batch waits for the reflowed title/version before export. These terminal captures use the font stack above, with white background for light and Pi's dark background otherwise. Earlier all-pages-22-row claims below describe historical revisions, not the current short-page layout.

![Compact root, light](assets/rtk/review/compact-root-light.png)

![Compact root, dark narrow](assets/rtk/review/compact-root-dark-narrow.png)

![Settings with wrapped description, light narrow](assets/rtk/review/compact-settings-light-narrow.png)

## Top controls and light-theme contrast

Before images below use `9771ed0`; after images use the subsequent top-controls repair. Each pair has the same 100x30 viewport, dataset, font and white terminal background. Scope/View now precede the report; the selected-setting description remains available, pagination follows the data and keyboard help stays at the bottom. Removing the Display heading frees two report rows without changing the 22-row panel.

The local built-in light correction raises accent/success/warning contrast against white from 4.34/4.32/4.33 to 6.40/6.36/6.15. Dim text rises from 4.54 to 5.25. All corrected colors also exceed 4.5 against #f8f8f8. This is measured palette contrast, not a claim about arbitrary terminal backgrounds, font rasterization or custom themes. Dark themes and custom themes with source metadata are unchanged. An in-memory theme named `light` without source metadata cannot be distinguished from the built-in; matching foreground sequences also receive the correction. The final Pi capture batch covers 15 light and 15 dark Usage states, including narrow pages, all 22 rows high.

| Daily before                                              | Daily after                                             |
| --------------------------------------------------------- | ------------------------------------------------------- |
| ![Daily before](assets/rtk/review/light-daily-before.png) | ![Daily after](assets/rtk/review/light-daily-after.png) |

| Failures before                                                 | Failures after                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| ![Failures before](assets/rtk/review/light-failures-before.png) | ![Failures after](assets/rtk/review/light-failures-after.png) |

![Light narrow layout](assets/rtk/review/light-narrow-after.png)

![Dark theme with top controls](assets/rtk/review/dark-top-controls-after.png)

## Previous repair: structured reports and sticky headers

The follow-up after `4040b986add263aa1cbb9c90c77513becc901ba6` keeps the title and column headers on every Daily, Weekly, Monthly and History page. Failures now decodes the native report into summary, recent records and top-command counts. Each section repeats its own header. Accent headings, green savings/recovery, red failed fallback and muted timestamps distinguish meanings without relying on color alone.

The final compiled-Pi run checked 15 captured states at 100x30 and 56x26, all with a 22-row panel. Period/History data came from controlled fixtures. Failures replayed byte-for-byte RTK 0.45.0 output from an isolated seeded database, containing 15 failures and 60% recovery. These are real Pi terminal exports, not personal usage data. RTK omits error reasons and truncates commands in its native report; the extension cannot recover omitted text. Parser tests verify preserved multiline command text, including blank lines and indentation.

![Daily page 2 with headers](assets/rtk/review/structured-daily-page2.png)

![Weekly page 2](assets/rtk/review/structured-weekly-page2.png)

![Monthly page 2](assets/rtk/review/structured-monthly-page2.png)

![History page 2](assets/rtk/review/structured-history-page2.png)

![Parsed recent failures](assets/rtk/review/structured-failures-recent.png)

![Top commands, final page](assets/rtk/review/structured-failures-top-last.png)

## Previous repair, before structured reports

The panel is 22 rows high across root, Settings, Usage and Diagnostics. Reports wrap and use `[` / `]` pagination instead of growing the dialog. Esc returns or closes, including with Pi cancel remapped to Ctrl+G; Ctrl+G does not exit RTK. Feature shortcuts and stable panel dimensions are recorded in [design.md](../design.md).

This native History capture shows page 2 of 2 at 56x26. All ten records from isolated RTK 0.45.0 remain reachable. Long-command fixtures also verify retained text across pages; text already omitted by native RTK cannot be recovered.

![Native History, final page](assets/rtk/review/fixed-history-last-56x26.png)

The previous repair paged raw failure text beyond 240 characters. This historical capture is superseded by the structured report above. Its fixture included a long reason-like text tail, not an error-reason field emitted by native RTK.

![Failure report, final page](assets/rtk/review/fixed-failures-last-56x26.png)

Leaving the root for Settings cancels the pending overview process. The controlled delayed-error case verified that its completion marker and notification never appeared. Settings also reserves space for probe and save states so controls do not move.

![Settings after cancelling the root query](assets/rtk/review/fixed-stale-root-settings.png)

The acceptance run measured 23 page states at 100x30 and 56x26, all 22 rows high. Keyboard traces covered page boundaries, long History/failure/configuration tails, literal Esc and remapped Ctrl+G at 45x20. Screenshots alone do not establish these interactions.

Capture correction: the first narrow overview export caught the terminal's cropped old frame immediately after resize. A no-input timing check observed the correctly reflowed values by roughly 50 ms and through 3 seconds; the guide uses the corrected export. That diagnostic script's later optional reopen step timed out, so it is not counted as a passed end-to-end run.

## Original findings

### 1. History loses access to records and command text

Open Usage / History with ten records. At 100x30 all ten fit. Resize to 56x26: only eight remain visible and command names are clipped, without a way to page through the hidden records.

![History at 100x30](assets/rtk/review/issue-1-history-100x30.png)

![History at 56x26](assets/rtk/review/issue-1-history-56x26.png)

### 2. Small-terminal exit hint ignores remapped keys

Remap cancel to Ctrl+G, open RTK at 45x20, then press Escape. The notice still says `Esc close`, but remains open. Ctrl+G closes it.

![Notice after Escape](assets/rtk/review/issue-2-remap-escape-still-open.png)

### 3. Advertised PageDown does not scroll Failures

Open a multi-page failure fixture at 56x26. PageDown leaves command-01 through command-04 visible. Pressing `]` advances to command-05 through command-12 instead.

![After PageDown](assets/rtk/review/issue-3-failures-after-pagedown.png)

![After right bracket](assets/rtk/review/issue-3-failures-after-right-bracket.png)

### 4. Failure fixture text disappears beyond the right edge

The same fixture line contains a reason-like suffix at 160x30. At 56x26 it ends at `--porc...`, hiding that text without wrapping or horizontal access. This fixture did not establish native RTK error-reason availability.

![Full failure line](assets/rtk/review/issue-4-failures-longline-160x30.png)

![Clipped failure line](assets/rtk/review/issue-4-failures-longline-56x26.png)

### 5. Previous page reports errors after navigation

Start a delayed overview request, enter Settings, then let the previous request fail. Its error notification appears above Settings even though the user has left that view.

![Stale overview error on Settings](assets/rtk/review/issue-5-pending-overview-notification-on-settings.png)
