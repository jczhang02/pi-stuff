# TUI design

[简体中文](docs/i18n/zh-CN/design.md) · English is normative.

Pi Stuff fits into Pi's interface, theme and interaction conventions, extending them when a feature needs it. These are shared design rules for future features; they do not describe an implemented Pi Stuff interface. The [agent instructions](AGENTS.md#detailed-procedures) define when to create a TUI prototype and which skill to use.

## TUI prototype fidelity

A TUI prototype presents the intended product interface directly. For the scenario being evaluated, its layout, spacing, copy, states and interactions must match the intended real interface. This standard applies while exploring a design; it does not require a completed product specification first.

Use real Pi TUI components in their intended host context, including the surrounding editor and statusline. Sample data and execution may be simulated in isolation. Keep displayed messages, paths, model information, counters and timing coherent with the scenario so implementation shortcuts do not distort the interface.

The evaluated terminal contains only product content and controls. Do not add demo/prototype badges, simulation disclaimers, guided-tour panels, debug state or prototype-only shortcuts. Normal product help, status and error feedback still belong in the interface. Removing a demo label also removes its reserved space.

Identify the artifact as a prototype in its files and delivery documentation. Explain simulated execution, unimplemented behavior and verification limits there. Put variant selection, replay, scenario injection and diagnostic inspection in launch arguments or a separate developer control surface outside the evaluated terminal; they must not take its space, focus or keybindings.

Inspect the actual terminal and exercise the interactions being evaluated before delivery. The user must be able to judge the screen and operate it without mentally removing demo elements or imagining missing UI behavior. Record remaining fidelity gaps outside the interface and do not claim exact parity without verification.

## Screenshot evidence

Terminal Control image exports that represent the maintainer's Ghostty setup must use this font stack explicitly:

```sh
--font-family "JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, LXGW WenKai Mono"
```

Do not rely on the exporter's default font list. A missing family can silently select another installed font and make the capture differ from the terminal under review. Record the font stack and palette with the evidence when either affects the judgment. This option controls the exported SVG or PNG; the live TUI still uses the font configured by its terminal.

## Prohibited overlay structures

Pi Stuff must not use either of these multi-section control overlays: a modal with horizontal section tabs across the top, or a modal with persistent side navigation. This rule applies across the repository even when Pi can technically render the structure.

A feature that needs comparable multi-section navigation must use another structure and follow the applicable real-component prototype process before that structure is accepted. Rejecting these overlays does not approve the drilldown prototype or any other replacement.

## Shared panel components

Use RTK as the reference for common panel structure, interaction and appearance. RTK and AutoName must share components for the title and borders, menu columns and spacing, settings layout, and keyboard hints. Reusing Pi's primitives alone does not satisfy this requirement. Keep these conventions in their shared owner so subsequent changes reach both panels. Features retain ownership of their content, actions and business logic.

RTK and AutoName home pages follow the same order: feature description, summary, then navigation. AutoName's summary shows the current name and the agreed persistence state; its menu places Settings before Generate name. Use the same navigation and settings-editing conventions, adapting fields and actions to each feature. Reuse these components for matching patterns in future panels. Shared presentation does not authorize new progress or status notices.

## Information and state

Make the current operation, key result and available next action easy to identify. Choose the layout and supporting detail with the feature.

Distinguish loading, no data, no matching results and failure where applicable within the feature's agreed interface. New progress/status notices, such as a `Naming...` statusline message or a loading notification, require explicit maintainer approval for that presentation. A request to implement a capability does not authorize adding these notices. Record the agreed feedback with the feature; using Pi's native API does not remove this requirement. Show a percentage only when actual progress can be calculated.

## Theme and feedback colors

Use Pi's active theme and semantic colors for text, selection, borders, success, warnings and errors. A custom component uses the theme Pi supplies to it. Communicate status in words as well as color, so the user can understand a failure without identifying its color.

Verify both built-in light and dark themes. A narrowly scoped contrast correction may adjust a demonstrated low-contrast built-in color within the feature, without mutating Pi's global theme or replacing custom palette values. Record the tested palette/background and retain semantic hue and text labels.

## Keyboard and focus

Prefer Pi's existing components and interaction patterns. Preserve configurable selection and submit bindings where applicable. Esc is the fixed back/exit key for Pi Stuff panels, including size notices and nested editors; do not replace it with a remapped cancel binding such as Ctrl+G. When a panel closes, restore focus to the input or invoking control.

Feature shortcuts must be directly usable on a 60% keyboard. Do not assign PageUp, PageDown, Home, End or function-row keys to feature actions. Use ordinary keys such as `[` and `]` for previous/next page, and show the actual supported keys in local help. Reuse Pi's native selection navigation without changing the host's global bindings.

Keep dimensions and control positions stable within a page during loading, refresh, saving and pagination. Different page types may use different heights: compact short menus and settings instead of padding them to a report's height. Reserve only the space needed for that page's transient feedback and wrapped descriptions. Long reports use a bounded content area with pagination and a visible page position; they must not enlarge the dialog as more records arrive. Resizing the terminal may change the content budget. Wrapping and pagination must preserve access to retained text, while clearly distinguishing any upstream truncation or explicit report-size limit.

Paged tables retain their title and column headers on every page. When a report has different sections, keep each page's section and column meanings visible. Parse external reports into the fields the interface presents; do not substitute a raw CLI dump for a structured view.

## Narrow terminals

Adapt to the available terminal width with wrapping, compact layouts and truncation where appropriate. If a path or other necessary value is shortened, provide a way to inspect its full content. Keep essential status and the exit action understandable.

When the terminal is too small to support a useful layout, show a clear size notice and preserve a way to exit. Choose the minimum dimensions with the actual feature; there is no shared fixed threshold yet.

## Cancellation and background work

Using a temporary panel's back or cancel action closes the panel and requests cancellation of the temporary operation it started, such as a search. Closing the panel must not silently turn that operation into a background task.

Work explicitly started as a background task may continue after its panel closes. Provide a way to inspect its status and stop it. Cancellation stops further work; it does not imply that completed changes have been undone. Define any rollback or recovery behavior with the specific feature.

## Operation feedback

Show failures through Pi's chat-area error notification and leave the text there without a timed dismissal. Explain the failed operation and its actual outcome, including whether a change was saved. Include the cause and a useful next step when known.

Use Pi's existing notification behavior for ordinary success messages too. Retaining a notice in the current chat display does not promise that it survives a reload, session reconstruction or restart. Persistent error history is not a shared requirement at this stage.

## Decide with each feature

Choose concrete layouts, information density, minimum terminal dimensions and feature-specific controls when the corresponding feature is designed. Define irreversible effects, cancellation limits and recovery at that point. The shared rules above do not require a prototype or a new test suite for every UI change; use the [agent workflow](AGENTS.md) and [quality policy](docs/quality-assurance.md) for the applicable work and evidence.
