---
name: prototype-tui
description: Build a throwaway TUI prototype to answer a design question. Use when the user wants to sanity-check a state model or logic in an interactive terminal, or explore what a terminal UI should look like.
license: MIT
---

# TUI Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

Read the project's design document, when present, for its components, theme and input conventions. Read and use the [tuistory skill](../tuistory/SKILL.md) to run and inspect a shared interactive terminal that the user can join.

## Pick a branch

Identify which question is being answered, using the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [LOGIC.md](LOGIC.md). Build a shareable terminal demo (free-play actions plus tabbed guided walkthroughs) that pushes the state machine through cases that are hard to reason about on paper, and that a non-developer can drive.
- **"What should this look like?"** → [UI.md](UI.md). Generate several radically different UI variations in a single terminal view, selectable through a command argument and an interactive switcher.

The two branches produce very different artifacts, so getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a screen or component → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or screen it's prototyping for) so context is obvious, but name it so a casual reader can see it's a prototype, not production. For throwaway TUI entrypoints, obey whatever convention the project already uses; don't invent a new top-level structure.
2. **Trivial to run.** Both branches start from one command in the project's task runner: `pnpm <name>`, `python <path>`, `bun <path>`, etc., using the existing project setup. Provide the working directory, launch command and Tuistory attachment command so the user can start the demo or join the running session.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE, wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
6. **Capture it when done.** Fold any validated decision into the real code, then capture the prototype itself as a **primary source**: commit it to a throwaway branch, out of main, and leave a context pointer to that branch on the implementation issue. Capture the answer too (the verdict and the question it settled) in the issue or a commit. The main branch keeps only the validated decision.
