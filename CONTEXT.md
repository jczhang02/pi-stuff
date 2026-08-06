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

**Capability Package**:
A distributable Package that owns one Capability and can be selected independently of the full Suite.
_Avoid_: module, plugin fragment

**Aggregate Package**:
The distributable Package that presents the ordered Suite as one installable Pi Package.
_Avoid_: runtime, launcher, wrapper CLI

**Runtime Resource**:
An Extension, Skill, Prompt Template, or Theme that the Host discovers through Pi's Package contract.
_Avoid_: asset, plugin file

**Settings Layer**:
User-owned declarations that select and configure Packages and Runtime Resources for a Host installation.
_Avoid_: Suite configuration, installer state

**Narrative Boundary**:
Visible Assistant prose, user input, or any visible model-context Custom Message that separates one Tool execution phase from the next. Thinking remains visible but does not create a boundary; hidden state and branch/compaction metadata do not either.
_Avoid_: Assistant message boundary, API turn, Thinking block

**Tool Activity Group**:
A derived display-only summary of every participating Tool call and result between adjacent Narrative Boundaries, including calls separated by Thinking. It preserves the individual protocol events and session history; an unsupported third-party Tool remains standalone and acts as a compatibility boundary.
_Avoid_: Exploration group, Tool batch, merged Tool call

**Todo Task**:
A planned unit of work maintained by the Suite's Task tools and checklist. It describes intent; it is not an executing process, wait, or Agent.
_Avoid_: Background task, job

**Background Work**:
Current-session activity that continues without occupying the main Agent, comprising a Background Shell, a Monitor, or a read-only projection of a running Agent. It is live management state, not a Todo Task or durable history.
_Avoid_: Todo, daemon, scheduler

**Background Shell**:
A Host-session-owned operating-system command that continues independently after an explicit background launch or foreground detach. It ends with the current Host session and never becomes a cross-session daemon.
_Avoid_: Job, service

**Monitor**:
A one-shot wait for one explicit observable condition in Background Work, such as a command result, log match, file state, or HTTP response. It is not a polling conversation, recurring loop, or schedule.
_Avoid_: Watcher, cron, polling task
