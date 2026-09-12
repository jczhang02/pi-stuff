---
name: prototype-tui
description: Build a throwaway TUI prototype to answer a design question. Use when the user wants to sanity-check a state model or logic in an interactive terminal, or explore what a terminal UI should look like.
license: MIT
---

# TUI Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

Before either branch, read [TUI prototype fidelity](../../../design.md#tui-prototype-fidelity), the authoritative presentation standard, and the rest of that design document for components, theme and input conventions. Read and use the [tuistory skill](../tuistory/SKILL.md) to run and inspect a shared interactive terminal that the user can join.

## Pick a branch

Identify which question is being answered, using the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [LOGIC.md](LOGIC.md). Exercise the relevant state transitions, with scenario drivers and diagnostic inspection outside any product UI being evaluated.
- **"What should this look like or how should it respond?"** → [UI.md](UI.md). Present the intended product interface. Compare alternatives when the design is open; use the user's selected design when it is already settled.

If the branch is ambiguous and the user is unavailable, use the surrounding task (a backend module → logic; a screen or interaction → UI) and record the assumption in the delivery notes. A UI exploration does not require a separate product specification before work can begin.

## Rules that apply to both

1. **Mark the source and delivery notes.** Locate the prototype code close to where it will be used and identify it in filenames or comments. Keep that identification outside the evaluated interface, as required by the design standard. Follow the project's existing entrypoint convention.
2. **Trivial to run.** Start either branch with one command using the project's existing runtime or task runner, such as `bun <path>` or `bun run <name>`. A direct entrypoint does not require a new package script. Provide the working directory, launch command and Tuistory attachment command.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE, wipe me" name.
4. **Keep implementation small.** Use only the execution and error handling needed for the scenario. Skip production infrastructure and a permanent prototype test suite; visual fidelity and working UI interactions remain required. Verify them through the actual terminal.
5. **Separate product feedback from diagnostics.** Show state changes through the intended product presentation. Inspect internal state and drive scenarios through developer controls outside that interface.
6. **Capture findings when done.** Record the question and verdict, then retain the runnable prototype on a throwaway branch outside main. Link that branch and its launch command from the related issue so the prototype remains a reproducible primary source. A prototype-only task ends with the artifact and findings. If product adoption is already within the implementation authorization, carry the validated decision into the real product work and resume product QA; do not infer that prototype feedback authorizes a separate product change.
