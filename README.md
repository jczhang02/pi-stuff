<div align="center">

# Pi Stuff

**A calmer, more capable Pi coding workflow.**

Focused interface, work, context, and integration capabilities for the native
[Pi coding agent](https://github.com/earendil-works/pi).

[简体中文](README.zh-CN.md) · [Contributing](CONTRIBUTING.md) · [Issues](https://github.com/jczhang02/pi-stuff/issues)

</div>

## Project status

This repository is at the project setup stage. It contains contribution templates, agent workflow conventions, and repository checks, but no installable Pi Stuff package yet. TypeScript, Bun `1.4.0`, and Effect v4 (`4.0.0-rc.112`) are the chosen stack; pure algorithms stay ordinary functions. This does not establish Pi host compatibility.

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
| [Issue tracker workflow](docs/agents/issue-tracker.md)         | GitHub and Beads responsibilities, sync, and public updates |
| [Beads setup](docs/agents/beads.md)                            | Local database, shared worktrees, skill, and authentication |
| [Triage labels](docs/agents/triage-labels.md)                  | Routing tasks to information gathering, agents, or humans   |
| [Domain documentation rules](docs/agents/domain.md)            | Reading domain terms and architecture decisions             |
| [TypeScript/Bun decision](docs/adr/0001-typescript-bun.md)     | Shared product and repository-check toolchain               |
| [Effect and quality decision](docs/adr/0002-effect-quality.md) | Framework, strict checks, and structural review             |
| [Engineering rules](docs/agents/engineering.md)                | Types, boundaries, formatting, and review obligations       |

English is normative. Human docs have linked English/Chinese counterparts updated in the same PR; agent instructions and skills remain English-only. Issues, PRs, and public comments are in English; conversation is in Chinese. Historical research is not being mass-translated.

## Contributing

Start with an existing issue or describe the problem using an issue template. Keep changes scoped and report the verification you actually performed. Agents use Beads for execution context and publish meaningful updates on GitHub; other contributors do not need Beads.

See [Contributing](CONTRIBUTING.md) for the workflow.

## Security

Treat extension code as executable software and review its source before running it. Keep credentials and personal information out of issues, logs, and screenshots. Report vulnerabilities through the private channel in the [security policy](.github/SECURITY.md), not public issues.

## Acknowledgments

[Pi](https://github.com/earendil-works/pi) provides the host for this project. [Best README Template](https://github.com/othneildrew/Best-README-Template) informed the README structure.

When third-party code or assets are added, retain their upstream notices and record their provenance alongside them.

## License

A project-wide license has not yet been added to this repository. The adapted GitHub CLI contribution templates retain their upstream MIT notice in [.github/TEMPLATE_LICENSE](.github/TEMPLATE_LICENSE); that notice does not license the rest of the project.
