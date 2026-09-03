---
status: accepted
---

# Preserve foreground reporting through Background Work handoff

## Context

A foreground Bash invocation can outlive the current Agent turn after `Ctrl+B` or the automatic runtime threshold.
Treating that Foreground Handoff like an explicitly independent background launch can leave its raw terminal
notification as the Session's last output, with no Agent turn available to produce a Completion Report.

## Decision

A Foreground Handoff changes execution placement, not ownership of the current user work. Its successful, failed, or
timed-out terminal outcome must reactivate the main Agent and be reconciled in a Completion Report. The Agent may emit
a clearly non-terminal handoff update while work remains active, but that update cannot discharge the reporting
obligation.

An explicit `run_in_background: true` launch remains independent and non-waking by default. This distinction is owned
by Background Work; it does not create a Suite-wide task coordinator or transfer Goal or Agents lifecycle authority.

A requested stop is acknowledged synchronously to its initiator and does not cause a second wake. Nearby required
outcomes may share one Agent turn, and an outcome delivered while the main Agent is active joins that turn instead of
starting a competing one. A Monitor outcome never discharges a Background Shell's reporting obligation, although both
outcomes may be delivered together.

On continuation, the Agent inspects the bounded terminal evidence and resumes the original authorized work instead of
merely echoing the command status. It produces the Completion Report only after no further in-scope work remains. A
handed-off Shell is its own terminal wake source; the Agent does not create a Monitor merely to watch that Shell.

Session shutdown ends both the owned process and its reporting obligation; the Suite does not resurrect it in another
Session. Background Work guarantees one eligible Agent continuation with an explicit reporting instruction. It does
not add an autonomous retry loop or semantic response validator for a later Host or model failure.

The implementation reuses whether the Shell was backgrounded at launch to distinguish an explicit independent launch
from a later Foreground Handoff. It does not add a public wake option, change the two-minute automatic handoff, or add a
new Conversation UI message state.

## Rejected alternatives

- Waking for every Background Shell would turn deliberately independent work into unsolicited Agent turns.
- Prompting the Agent to remember the report cannot help when no later Agent turn is started.
- A cross-Capability work coordinator would expand lifecycle authority without evidence that Goal or Agents caused
  this failure.
- A special provisional-message UI, another wake parameter, or removing automatic handoff would expand the public
  surface without repairing the missing continuation at its owning seam.
- A Monitor that shadows every handed-off Shell would duplicate terminal authority and retain the timeout race that
  exposed this failure.

## Consequences

Completion requires focused coverage for manual and automatic handoff across success, failure, and timeout; retained
non-waking behavior for explicit background launch, stop, and shutdown; Monitor ordering and notification batching;
the reported Monitor-timeout-before-Shell-completion sequence; and representative real-Host evidence that a terminal
handoff resumes the Agent and ends in a non-empty Completion Report without another user message.
