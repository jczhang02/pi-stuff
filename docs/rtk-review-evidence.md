# RTK UI review evidence

[中文](i18n/zh-CN/rtk-review-evidence.md)

These captures reproduce five unresolved UI findings at `ff92ddd787023d36e919adab7e2babadd355b7a7`. The subsequent repair round changes non-UI behavior only. They are evidence of defects, not accepted designs.

Environment: Linux, compiled Pi 0.85.1, Bun 1.4.0, RTK 0.45.0, Pi dark palette, and `JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono`. PNGs are Terminal Control exports from real Pi sessions, not desktop-window screenshots or redrawn mockups. Configuration, HOME and statistics were isolated. History uses actual native RTK records; failure and delayed-error cases use controlled process fixtures. A still image does not prove a keypress; the reproduction traces below describe the observed interaction.

## 1. History loses access to records and command text

Open Usage / History with ten records. At 100x30 all ten fit. Resize to 56x26: only eight remain visible and command names are clipped, without a way to page through the hidden records.

![History at 100x30](assets/rtk/review/issue-1-history-100x30.png)

![History at 56x26](assets/rtk/review/issue-1-history-56x26.png)

## 2. Small-terminal exit hint ignores remapped keys

Remap cancel to Ctrl+G, open RTK at 45x20, then press Escape. The notice still says `Esc close`, but remains open. Ctrl+G closes it.

![Notice after Escape](assets/rtk/review/issue-2-remap-escape-still-open.png)

## 3. Advertised PageDown does not scroll Failures

Open a multi-page failure fixture at 56x26. PageDown leaves command-01 through command-04 visible. Pressing `]` advances to command-05 through command-12 instead.

![After PageDown](assets/rtk/review/issue-3-failures-after-pagedown.png)

![After right bracket](assets/rtk/review/issue-3-failures-after-right-bracket.png)

## 4. Failure reasons disappear beyond the right edge

The same failure line contains its reason at 160x30. At 56x26 it ends at `--porc...`, hiding the reason without wrapping or horizontal access.

![Full failure line](assets/rtk/review/issue-4-failures-longline-160x30.png)

![Clipped failure line](assets/rtk/review/issue-4-failures-longline-56x26.png)

## 5. Previous page reports errors after navigation

Start a delayed overview request, enter Settings, then let the previous request fail. Its error notification appears above Settings even though the user has left that view.

![Stale overview error on Settings](assets/rtk/review/issue-5-pending-overview-notification-on-settings.png)
