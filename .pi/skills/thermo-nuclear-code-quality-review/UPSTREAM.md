# Review skill source

Source: https://github.com/cursor/plugins/blob/71ed0d1076fec562c1b74ee353121a8d00f75382/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md

`SKILL.md` is an unmodified copy; the Cursor team kit's MIT license is retained as `LICENSE`. Updates require a reviewed PR.

Pi discovers this directory after the project is trusted. Upstream sets `disable-model-invocation: true`, so it does not advertise itself in the model's skill list. Invoke `/skill:thermo-nuclear-code-quality-review` manually, or follow this repository's explicit AGENTS.md/PR-policy pointer to read it for substantive code changes. No global skill installation is required.

The repository requires this quality standard. Review runs in a separate, read-only context against a pinned full diff; the task owner implements fixes. Concrete structural findings are presumptive blockers until fixed or refuted with evidence and independently rechecked. Unresolved disagreements go to the maintainer. The skill's ambitious restructuring language does not authorize the reviewer to edit files, widen task scope, access credentials, or merge.
