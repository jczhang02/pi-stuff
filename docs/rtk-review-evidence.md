# RTK UI review evidence

[中文](i18n/zh-CN/rtk-review-evidence.md)

The UI repair after `99b7edf59aec91a692742e5e7ae9d3f055b97bd7` addresses the five findings below. The original captures are retained as before-state evidence, not accepted designs.

Environment: Linux, compiled Pi 0.85.1, Bun 1.4.0, RTK 0.45.0, Pi dark palette, and `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. PNGs are Terminal Control exports from real Pi sessions, not desktop-window screenshots or redrawn mockups. Configuration, HOME and statistics were isolated. History uses actual native RTK records; failure and delayed-error cases use controlled process fixtures. A still image does not prove a keypress; the reproduction traces below describe the observed interaction.

## Repaired behavior

The panel is 22 rows high across root, Settings, Usage and Diagnostics. Reports wrap and use `[` / `]` pagination instead of growing the dialog. Esc returns or closes, including with Pi cancel remapped to Ctrl+G; Ctrl+G does not exit RTK. Feature shortcuts and stable panel dimensions are recorded in [design.md](../design.md).

This native History capture shows page 2 of 2 at 56x26. All ten records from isolated RTK 0.45.0 remain reachable. Long-command fixtures also verify retained text across pages; text already omitted by native RTK cannot be recovered.

![Native History, final page](assets/rtk/review/fixed-history-last-56x26.png)

Failure reports preserve retained lines beyond 240 characters and page their wrapped text. The last-page capture shows the final record; the interaction check separately visited the long reason's tail on an earlier page.

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

### 4. Failure reasons disappear beyond the right edge

The same failure line contains its reason at 160x30. At 56x26 it ends at `--porc...`, hiding the reason without wrapping or horizontal access.

![Full failure line](assets/rtk/review/issue-4-failures-longline-160x30.png)

![Clipped failure line](assets/rtk/review/issue-4-failures-longline-56x26.png)

### 5. Previous page reports errors after navigation

Start a delayed overview request, enter Settings, then let the previous request fail. Its error notification appears above Settings even though the user has left that view.

![Stale overview error on Settings](assets/rtk/review/issue-5-pending-overview-notification-on-settings.png)
