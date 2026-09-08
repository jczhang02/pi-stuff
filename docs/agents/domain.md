# Domain docs

[Chinese reading reference](../i18n/zh-CN/agents/domain.md). English is authoritative; the translation is for human readers.

## Read before exploring

This repository uses a single context:

- Root `CONTEXT.md` defines domain terms and the model.
- `docs/adr/` holds architecture decision records.

Before exploring code, read `CONTEXT.md` if present, then the ADRs relevant to the work.

If these files do not exist, proceed silently. Do not create placeholders or suggest creating them solely because they are absent. The domain-modeling workflow creates them when terms or decisions are resolved.

## Use the glossary

Use the terms defined in `CONTEXT.md` when naming domain concepts in issues, design proposals, tests, and code discussions. If a needed term is missing, reconsider whether it belongs to the project; flag genuine gaps for domain modeling.

## Surface decision conflicts

If a proposal contradicts an existing ADR, identify that ADR and explain why the decision should be reconsidered. Do not silently override it.
