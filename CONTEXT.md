# Pi Stuff

[简体中文](docs/i18n/zh-CN/CONTEXT.md) · English is normative.

Pi Stuff extends Pi for the maintainer's development workflow.

## Language

**Web access**:
Pi Stuff's capability for searching the web, reading public page text, and consulting previously retrieved content within Pi.

**Tool switch**:
An independent setting for whether a Pi Stuff tool is available for direct model calls. It is an entry-point setting, not a prohibition on every internal use of the underlying capability.

**Subagent**:
A delegate with its own identity and conversation context, retained across successive assignments.

**Subagent task**:
One assignment to a subagent, with its own execution record and result. A follow-up is a new task for the same subagent.

**Subagent task baseline**:
The code state from which a subagent task begins, before that task adds its own changes.

**Skipped task**:
A subagent task that ended without starting because a dependency failed.

**Cancelling task**:
A subagent task whose cancellation has been requested but whose execution has not yet been confirmed stopped.

**Completed subagent task**:
A task whose subagent has reported the assignment fulfilled and whose descendants have all ended. Completion does not itself establish acceptance by the main agent.
