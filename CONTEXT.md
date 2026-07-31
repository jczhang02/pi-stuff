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
