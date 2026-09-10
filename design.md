# TUI design

[简体中文](docs/i18n/zh-CN/design.md) · English is normative.

Pi Stuff fits into Pi's interface, theme and interaction conventions, extending them when a feature needs it. These are shared design rules for future features; they do not describe an implemented Pi Stuff interface. The [agent instructions](AGENTS.md#review-and-design) define when and how to create a UI prototype.

## Information and state

Make the current operation, key result and available next action easy to identify. Choose the layout and supporting detail with the feature.

Distinguish loading, no data, no matching results and failure where applicable. Give long-running operations visible status feedback. Show a percentage only when actual progress can be calculated. Prefer Pi's existing components and presentation conventions for these states.

## Theme and feedback colors

Use Pi's active theme and semantic colors for text, selection, borders, success, warnings and errors. A custom component uses the theme Pi supplies to it. Communicate status in words as well as color, so the user can understand a failure without identifying its color.

## Keyboard and focus

Prefer Pi's existing components and interaction patterns. Follow its navigation, submit, back and cancel conventions, including user-configured keybindings where applicable. When a panel closes, restore focus to the input or invoking control. Extend the controls only where the feature needs an interaction Pi does not already provide.

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
