# Pi Stuff

[简体中文](docs/i18n/zh-CN/CONTEXT.md) · English is normative.

Pi Stuff extends Pi for the maintainer's development workflow.

## Language

**Web access**:
Pi Stuff's capability for searching the web, reading public page text, and consulting previously retrieved content within Pi.

**Tool switch**:
An independent setting for whether a Pi Stuff tool is available for direct model calls. It is an entry-point setting, not a prohibition on every internal use of the underlying capability.

**Pi compatibility target**:
A Pi host version that Pi Stuff intends to accommodate. Being a target does not mean that host acceptance has passed.

**Pi support range**:
The interval of Pi host versions that Pi Stuff commits to maintain in its declared runtime environment. Intermediate versions belong to that commitment even when they are not direct acceptance samples.

**Verified Pi version**:
A Pi host version with recorded acceptance evidence for a specific Pi Stuff revision and runtime environment. This evidence is narrower than the support range.

**Skill reference**:
A complete textual mention of a skill in the `/skill:<name>` form. A reference alone does not establish that the skill is installed or invoked.

**Highlight keyword**:
Editor text selected by a user-configured matching rule for the same visual emphasis as a skill reference. A match does not request an action.

**Fenced visualization**:
A display of a chart or tree described by a complete Markdown code block. The visualization and its original message text represent the same conversation content.

**Statusline segment**:
A distinct piece of status information shown in Pi Stuff's session footer, such as context usage or Git state.

**Third-party status segment**:
A statusline segment whose information is supplied by another extension, rather than by Pi Stuff's core statusline.

**Cache-hit ratio**:
The proportion of input tokens served from cache in the latest valid model response on the current session branch. It is not a cumulative session ratio.
