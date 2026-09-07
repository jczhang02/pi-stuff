# Triage labels

| Skill role | Repository label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Waiting for maintainer assessment |
| `needs-info` | `needs-info` | Waiting for information needed to proceed |
| `ready-for-agent` | `ready-for-agent` | Scope and acceptance criteria are clear; ready for agent execution |
| `ready-for-human` | `ready-for-human` | The next step requires human implementation or a decision |
| `wontfix` | `wontfix` | Will not be actioned |

Use this mapping whenever a skill names a triage role. When changing the triage outcome, remove obsolete triage labels and keep the one that applies. Type labels such as `bug` may coexist with it.

For `needs-info`, state exactly what is missing. For `ready-for-human`, name the required human action. For `wontfix`, explain the reason and normally close the issue.

Triage labels describe routing, not execution progress. Track in-progress and completed work using task state.

The complete label definitions, including colors and type labels, are in `.github/labels.json`. That file is a manifest, not an automatic GitHub configuration mechanism.
