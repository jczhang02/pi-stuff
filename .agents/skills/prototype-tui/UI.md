# UI Prototype

Build an interactive preview of the intended product screen. Apply [TUI prototype fidelity](../../../design.md#tui-prototype-fidelity) throughout. The user evaluates the rendered interface and its behavior directly.

Use this branch for layout, information density, copy, navigation, focus and interaction feedback. Use [LOGIC.md](LOGIC.md) when the question concerns a state model or data shape.

## Host context

Prefer the existing screen where the feature belongs. Mount the proposed UI alongside its real surrounding components so the editor, statusline, available space and input ownership constrain the design. Use an isolated host when sample execution must be separated from live work, while preserving the intended interface.

Create a standalone screen only when the proposed feature has no existing host. Follow the project's entrypoint convention and identify prototype source in its path or filename.

## Process

### 1. Choose what to evaluate

Use the user's current design choices and record the open UI question in the delivery notes or source comments. Work on the selected design when it is settled. When alternatives are useful and their number is unspecified, start with three structurally different candidates; this is an exploration default, not a prerequisite for every prototype.

### 2. Build the intended interface

Use the project's native components, theme and input conventions. Populate the screen with a coherent usage scenario, including enough surrounding content to judge density. Simulated replies and counters must fit that scenario and change consistently with its events.

Wire the interactions under evaluation: selection, entry, return, editing, submission, interruption and state feedback where applicable. A visible action must produce its intended UI response even when execution behind it is simulated. Represent unfinished execution with sample events; record any remaining UI gap in the delivery notes.

For alternatives, vary the relevant structure or information hierarchy. Keep each candidate independent enough to answer the open question; reuse components where they do not predetermine the layout.

### 3. Drive scenarios outside the screen

Select a candidate through a launch argument such as `--variant=B`, or run candidates in separate named Tuistory sessions. Replay, reset and forced states use launch options or a separate developer driver. Keep the same sample scenario when comparing candidates.

The evaluated screen contains the candidate's product controls only. Prototype switching must not add a toolbar, label, hidden key handler or reserved row to it. Provide commands and scenario instructions in the handoff rather than rendering them in the product terminal.

### 4. Verify the actual experience

Run and inspect the actual TUI through [Tuistory](../tuistory/SKILL.md). Exercise the chosen scenario and its visible actions, including focus restoration and any normal/loading/waiting/failure/completion states relevant to the design. Inspect the intended theme and terminal sizes; correct rendering failures before handing over the screen.

Capture actual terminal screenshots after checking the content. Judge the whole screen, including host chrome and empty space. Apply the design document's fidelity criterion; backend simulation is not a reason to leave presentation or interaction defects.

### 5. Hand it over

Provide the working directory, launch command, Tuistory attachment command and any external scenario or variant controls. Explain simulation and verification limits in those notes. The user should be able to join the terminal and evaluate the product UI immediately.

### 6. Capture findings and retain the artifact

Follow [SKILL.md](SKILL.md) for findings, branch retention and product-adoption authorization. Record the selected design and remaining UI questions. Prototype feedback alone does not authorize separate production implementation.
