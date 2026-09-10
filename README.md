<div align="center">

# Pi Stuff

**A calmer, more capable Pi coding workflow.**

Focused interface, work, context, and integration capabilities for the native
[Pi coding agent](https://github.com/earendil-works/pi).

[简体中文](docs/i18n/zh-CN/README.md) · [Contributing](CONTRIBUTING.md) · [Issues](https://github.com/jczhang02/pi-stuff/issues)

</div>

## Project status

This repository is at the project setup stage. It contains contribution templates, agent workflow conventions, and repository checks, but no installable Pi Stuff package yet. TypeScript, Bun `1.4.0`, and Effect v4 (`4.0.0-rc.112`) are the chosen stack; pure algorithms stay ordinary functions. The initial extension target is the maintainer's Bun-compiled Pi host. Supported versions will require actual host acceptance evidence.

The capabilities below describe the product direction, not implemented features. Installation instructions, supported versions, and screenshots will be added as the corresponding code and checks become available.

## About

Pi Stuff aims to keep everyday work inside Pi while making conversations easier to read and longer tasks easier to manage. The planned capabilities fall into four areas:

- A quiet, readable interface for conversations, tool activity, and session names.
- Goals, background tasks, delegated agents, and todo tracking.
- Side questions and notifications that do not interrupt the main thread.
- Optional context, web, MCP, RTK, Codex, and Code Mode integrations.

These layers provide a starting point for this repository. Individual capabilities need an agreed scope and acceptance criteria before implementation.

## Getting started

For now, clone the repository to review the project conventions or contribute to setup:

```bash
git clone https://github.com/jczhang02/pi-stuff.git
cd pi-stuff
```

Read [Contributing](CONTRIBUTING.md) before starting work. Coding agents must also read [AGENTS.md](AGENTS.md).

There is no Pi Stuff extension to install yet. To install development dependencies and run the repository checks with Bun, follow the [verification instructions](CONTRIBUTING.md#verify-changes).

## Documentation

| Document                                                       | Purpose                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| [Contributing](CONTRIBUTING.md)                                | Issues, focused changes, verification, and pull requests    |
| [Agent instructions](AGENTS.md)                                | Agent writing and Git workflow requirements                 |
| [TUI design](design.md)                                        | Pi themes, controls, narrow terminals and feedback          |
| [Task workflow](docs/agents/workflow.md)                       | PR scope, prerequisites, rollback, Git and worktrees        |
| [Issue tracker workflow](docs/agents/issue-tracker.md)         | GitHub and Beads responsibilities, sync, and public updates |
| [Beads setup](docs/agents/beads.md)                            | Local database, shared worktrees, skill, and authentication |
| [Triage labels](docs/agents/triage-labels.md)                  | Routing tasks to information gathering, agents, or humans   |
| [Domain documentation rules](docs/agents/domain.md)            | Reading domain terms and architecture decisions             |
| [TypeScript/Bun decision](docs/adr/0001-typescript-bun.md)     | Shared product and repository-check toolchain               |
| [Effect and quality decision](docs/adr/0002-effect-quality.md) | Framework, strict checks, and structural review             |
| [Engineering rules](docs/agents/engineering.md)                | Types, boundaries, formatting, and review obligations       |
| [Quality assurance](docs/quality-assurance.md)                 | Four QA activities, five test levels and execution policy   |

English is normative. Human docs have linked English/Chinese counterparts, with Chinese versions under `docs/i18n/zh-CN/`, updated in the same PR. New or substantively updated human-facing GitHub prose is English first, Chinese second; agent instructions and skills remain English-only, and conversation is in Chinese. See [language and presentation](CONTRIBUTING.md#language-and-presentation) for scope, exceptions, and Markdown guidance. Historical documents under `docs/` retain Chinese counterparts and remain clearly marked; do not bulk-rewrite historical discussions or machine-generated metadata.

## Contributing

Start with an existing issue or describe the problem using an issue template. Keep changes scoped and report the verification you actually performed. Agents use Beads for execution context and publish meaningful updates on GitHub; other contributors do not need Beads.

See [Contributing](CONTRIBUTING.md) for the workflow.

## Security

Treat extension code as executable software and review its source before running it. Keep credentials and personal information out of issues, logs, and screenshots. Report vulnerabilities through the private channel in the [security policy](.github/SECURITY.md), not public issues.

## Acknowledgments

[Pi](https://github.com/earendil-works/pi) provides the host for this project. [Best README Template](https://github.com/othneildrew/Best-README-Template) informed the README structure.

When third-party code or assets are added, retain their upstream notices and record their provenance alongside them.

## License

Project-owned code and documentation are licensed under [MIT](LICENSE). Third-party materials retain their own notices, including [.github/TEMPLATE_LICENSE](.github/TEMPLATE_LICENSE), the [review skill license](.agents/skills/thermo-nuclear-code-quality-review/LICENSE), and notices under `tools/`.
