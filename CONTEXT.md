# Pi Stuff

Pi Stuff names the concepts used to assemble a personal set of Pi capabilities without replacing Pi itself.

## Language

**Host**:
The native Pi coding agent process that discovers, loads, and runs Runtime Resources.
_Avoid_: Suite runtime, custom agent

**Suite**:
The cohesive collection of personal Pi capabilities selected for use together.
_Avoid_: agent, framework, platform

**Capability**:
One coherent, independently understandable behavior contributed to the Suite.
_Avoid_: feature bundle, miscellaneous extension

**Pi Stuff Package**:
The single local Pi Package that presents the ordered Suite to the Host.
_Avoid_: aggregate, launcher, wrapper CLI

**Capability Module**:
An internal, independently understandable implementation boundary for one Capability. It has no package manifest,
version, installation, or publication lifecycle of its own.
_Avoid_: Capability Package, npm package, plugin fragment

**Diagnostic Record**:
A bounded, current-process account of a Suite problem for human inspection. It never enters Session history or model
context. The owning Capability presents ordinary state locally; only a user-relevant problem may raise the shared
one-row notice, with details available through `/diagnostics`.
_Avoid_: console warning, transcript message, notification log

**Runtime Resource**:
An Extension, Skill, Prompt Template, or Theme that the Host discovers through Pi's Package contract.
_Avoid_: asset, plugin file

**Session Name**:
Pi-owned Session metadata that gives one coding conversation a concise semantic identity. Session Naming may propose
and persist this value after settled direct-user work, but it does not replace the Session, task, Goal, or Agent name.
_Avoid_: chat title, task name, autoname state

**Settings Layer**:
User-owned declarations that select and configure Packages and Runtime Resources for a Host installation.
_Avoid_: Suite configuration, installer state

**Narrative Boundary**:
Visible Assistant prose, user input, or any visible model-context Custom Message that separates one Tool execution phase from the next. Thinking remains visible but does not create a boundary; hidden state and branch/compaction metadata do not either.
_Avoid_: Assistant message boundary, API turn, Thinking block

**Tool Activity Group**:
A derived display-only summary of one continuous retrieval segment within a user turn. Read, Grep/Find, List, and
conservatively classified read-only Bash calls may participate across Tool results and Thinking. Consequential,
unsupported, and unknown Tools remain independent and bound the segment. The individual protocol events, ordering,
and Session history remain unchanged.
_Avoid_: Exploration group, Tool batch, merged Tool call

**Bash Operation Block**:
A display-only projection of one Bash Tool call, with one bounded command title and child output preview. It appears at
the call's native position when Bash is independent and is restored there when a retrieval group is expanded. Shell
composition inside the call remains one operation, and the underlying Tool result and Session records are unchanged.
_Avoid_: Command group, parsed subcommand, Tool Activity Group

**Envelope Fallback Row**:
The single ordinary Tool row that represents a Tool envelope only when no nested operation owns its outcome, or when
the envelope itself fails after every nested operation succeeds. Valid nested rows remain the sole visible authority;
missing historical definitions and presentation failures instead use generic rows at their original source positions.
_Avoid_: Envelope chrome, raw Tool result, duplicate error row

**Context Activity**:
A model-invisible, persisted Session record for one user-started Context maintenance operation. One visible Pi Stuff row
projects its anchor and later updates after resume. It is not a Tool call, Diagnostic Record, or Statusline item.
_Avoid_: Context Tool Activity, Context notification, Context status

**Fenced Visualization Projection**:
A display-only conversion of a complete, valid `chart` or `tree` fenced code block into width-bounded terminal text at
the Conversation Markdown seam. Canonical message text, Session records, copy/export source, and Provider context remain
unchanged; failed validation preserves the original fence.
_Avoid_: Fenced Block plugin, visualization runtime, transformed Session content

**Todo Task**:
A planned unit of work maintained by the Suite's Task tools and checklist. It describes intent; it is not an executing process, wait, or Agent.
_Avoid_: Background task, job

**Background Work**:
Current-session activity that continues without occupying the main Agent, comprising a Background Shell or a Monitor.
It is live management state, not a Todo Task, Agent projection, Tool invocation, or durable history.
_Avoid_: Todo, daemon, scheduler

**Background Shell**:
A Host-session-owned operating-system command that continues independently after an explicit background launch or foreground detach. It ends with the current Host session and never becomes a cross-session daemon.
_Avoid_: Job, service

**Monitor**:
A one-shot wait for one explicit observable condition in Background Work, such as a command result, log match, file state, or HTTP response. It is not a polling conversation, recurring loop, or schedule.
_Avoid_: Watcher, cron, polling task
