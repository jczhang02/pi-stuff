# Logic Prototype

A runnable state-model probe for questions about **business logic, state transitions, or data shape**. When it includes a product UI, apply [TUI prototype fidelity](../../../design.md#tui-prototype-fidelity); keep scenario drivers and diagnostic inspection outside that interface.

Because it runs with one command using the existing project setup, or by joining its shared Tuistory session, you can hand it to a non-developer (a designer, a PM, a domain expert) and let them feel the model for themselves. So it speaks their language, not the code's.

## When this is the right shape

- "I'm not sure if this state machine handles the edge case where X then Y."
- "Does this data model actually let me represent the case where..."
- "I want to feel out what the API should look like before writing it."
- Anything where someone wants to **trigger actions and watch state change**.

If the question is "what should this look like," this is the wrong branch. Use [UI.md](UI.md).

## Process

### 1. State the question

Record the state model and question in the delivery notes or source comments before writing code. Include the scenario instructions there so the user can return to them without adding an introduction to the product screen.

### 2. Isolate the logic in a portable module

Put the actual logic (the bit that's answering the question) in a small, pure module that could be lifted out and dropped into the real codebase later. The terminal UI around it is throwaway; this module isn't.

The right shape depends on the question:

- **A pure reducer**: `(state, action) => state`. Good when actions are discrete events and state is a single value.
- **A state machine**: explicit states and transitions. Good when "which actions are even legal right now" is part of the question.
- **A small set of pure functions** over a plain data type. Good when there's no implicit current state, just transformations.
- **A class or module with a clear method surface** when the logic genuinely owns ongoing internal state.

Pick whichever shape best fits the question being asked, _not_ whichever is easiest to wire to a terminal view. Keep it pure: no terminal I/O, no widget references, no input handlers reaching inside it. The view calls into it; nothing flows the other direction. This is what makes the prototype useful past its own lifetime: once the question's answered, the validated reducer / machine / function set lifts into the real module on its own.

### 3. Exercise the model

One runnable entrypoint using the project's existing runtime and TUI setup, with the question-specific logic kept portable. Follow its design document for components, theme and input conventions. Anyone should be able to run it with the supplied command or join the shared Tuistory session.

Drive actions through the intended product controls where they exist. Show their results through the product's normal state and feedback presentation. Supply deterministic setup, reset, forced transitions and full internal-state inspection through launch arguments or a separate developer entrypoint. Keep walkthrough steps in the delivery notes; begin each scenario from a known state.

For a model with no product screen, use a developer inspection entrypoint to exercise it and inspect its state. That inspector is a logic artifact, not evidence of the product's final interface.

Choose scenarios that demonstrate the awkward cases, the ones hard to reason about on paper: the happy path, a tricky edge case, an attempt at something that should be illegal.

Inspect the resulting behavior in the actual terminal. Product loading indicators and other visible feedback should behave as intended, even when their events come from the scenario driver.

### 4. Hand it over

Give them the launch command, working directory and Tuistory attachment command, or open the terminal for them. They'll step through the walkthroughs and free-play whenever they get to it; the interesting moments are when they say "wait, that shouldn't be possible" or "huh, I assumed X would be different"; those are the bugs in the _idea_, which is the whole point. If they want new actions or a new scenario, add them. Prototypes evolve.

### 5. Capture findings and decide whether to adopt

When the prototype answers its question, follow the capture and source-retention boundary in [SKILL.md](SKILL.md). A prototype-only task ends with the runnable artifact and findings. If product adoption is already within the implementation authorization, lift the validated reducer, state machine, or function set into the real module and resume product QA; keep the terminal shell as prototype work.

## Anti-patterns

- **Keep checks proportionate.** Exercise the relevant transitions and UI behavior; avoid a permanent test suite for the throwaway shell.
- **Don't wire it to the real database.** Use in-memory state unless the question is specifically about persistence.
- **Don't generalise.** No "what if we wanted to support X later." The prototype answers one question.
- **Don't blur the logic and the terminal view together.** If the pure module references terminal I/O, widgets, or input handlers, it's no longer liftable. Keep the view as a thin shell over a pure module.
- **Don't add a framework, bundler, or server for the demo.** Use the project's existing TUI setup and one launch command; extra setup defeats "shareable".
- **Don't ship the terminal shell into production.** The view is optimised for being driven by hand. The logic module behind it is the bit worth keeping.
