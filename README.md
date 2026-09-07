<div align="center">

# Pi Stuff

**A calmer, more capable Pi coding workflow.**

Focused interface, work, context, and integration capabilities for the native
[Pi coding agent](https://github.com/earendil-works/pi).

[Contributing](CONTRIBUTING.md) · [Issues](https://github.com/jczhang02/pi-stuff/issues)

</div>

## Project status

This repository is at the project setup stage. It contains contribution templates and agent workflow conventions, but no installable Pi Stuff package yet.

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

There is no package installation or test command for this repository yet.

## Documentation

| Document | Purpose |
| --- | --- |
| [Contributing](CONTRIBUTING.md) | Issues, focused changes, verification, and pull requests |
| [Agent instructions](AGENTS.md) | Agent writing and Git workflow requirements |
| [Issue tracker workflow](docs/agents/issue-tracker.md) | GitHub and Beads responsibilities, sync, and public updates |
| [Triage labels](docs/agents/triage-labels.md) | Routing tasks to information gathering, agents, or humans |
| [Domain documentation rules](docs/agents/domain.md) | Reading domain terms and architecture decisions |

## Contributing

Start with an existing issue or describe the problem using an issue template. Keep changes scoped and report the verification you actually performed. Agents use Beads for execution context and publish meaningful updates on GitHub; other contributors do not need Beads.

See [Contributing](CONTRIBUTING.md) for the workflow.

## Security

Treat extension code as executable software and review its source before running it. Keep credentials and personal information out of issues, logs, and screenshots. Do not disclose exploitable vulnerabilities in public issues; a private reporting policy and channel still need to be established for this repository.

## Acknowledgments

[Pi](https://github.com/earendil-works/pi) provides the host for this project. [Best README Template](https://github.com/othneildrew/Best-README-Template) informed the README structure.

When third-party code or assets are added, retain their upstream notices and record their provenance alongside them.

## License

A project-wide license has not yet been added to this repository. The adapted GitHub CLI contribution templates retain their upstream MIT notice in [.github/TEMPLATE_LICENSE](.github/TEMPLATE_LICENSE); that notice does not license the rest of the project.
