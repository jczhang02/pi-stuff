"""Check tracked repository documents and configuration without network access."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

import yaml


class RepoLoader(yaml.SafeLoader):
    """Keep YAML's `on` key a string and reject duplicate mapping keys."""

    yaml_implicit_resolvers = copy.deepcopy(yaml.SafeLoader.yaml_implicit_resolvers)

    def construct_mapping(self, node, deep=False):
        result = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in result:
                raise ValueError(f"duplicate YAML key: {key}")
            result[key] = self.construct_object(value_node, deep=deep)
        return result


for initial, resolvers in RepoLoader.yaml_implicit_resolvers.items():
    RepoLoader.yaml_implicit_resolvers[initial] = [
        item for item in resolvers if item[0] != "tag:yaml.org,2002:bool"
    ]
RepoLoader.add_implicit_resolver(
    "tag:yaml.org,2002:bool", re.compile(r"^(?:true|false)$", re.I), list("tTfF")
)


def load_yaml(text):
    return yaml.load(text, Loader=RepoLoader)


def load_json(text):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result

    return json.loads(text, object_pairs_hook=unique_pairs)


def check_text(text):
    errors = []
    if "\r" in text:
        errors.append("use LF line endings")
    if text and not text.endswith("\n"):
        errors.append("missing final newline")
    for number, line in enumerate(text.splitlines(), 1):
        if line.rstrip() != line:
            errors.append(f"line {number}: trailing whitespace")
        if "\t" in line:
            errors.append(f"line {number}: use spaces, not tabs")
    return errors


def check_markdown(root, path, text):
    errors = []
    prose = []
    fence = None
    for number, line in enumerate(text.splitlines(), 1):
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})(.*)$", line)
        if marker:
            run, rest = marker.groups()
            if fence is None:
                fence = run
            elif run[0] == fence[0] and len(run) >= len(fence) and not rest.strip():
                fence = None
            continue
        if fence is None:
            if re.match(r"^#{1,6}[^#\s]", line):
                errors.append(f"line {number}: add a space after heading markers")
            prose.append(line)
    if fence is not None:
        errors.append("unclosed fenced code block")
    body = "\n".join(prose)
    # File targets only: this is not a full Markdown parser or anchor checker.
    links = re.findall(r"!?\[[^\]\n]*\]\(\s*<?([^\s)>]+)>?(?:\s+[^)]*)?\)", body)
    links += re.findall(r"^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?", body, re.M)
    links += re.findall(r"(?:href|src)=[\"']([^\"']+)[\"']", body)
    for link in links:
        url = urlsplit(link)
        if url.scheme or url.netloc or not url.path:
            continue
        decoded = unquote(url.path)
        target = (root / decoded.lstrip("/") if decoded.startswith("/") else path.parent / decoded).resolve()
        if not target.is_relative_to(root.resolve()):
            errors.append(f"local link escapes the repository: {link}")
        elif not target.exists():
            errors.append(f"missing local link target: {link}")
    return errors


def check_labels(labels):
    if not isinstance(labels, list):
        raise ValueError("label manifest must be a list")
    seen = set()
    for label in labels:
        name = label["name"]
        if not isinstance(name, str) or not name or name.casefold() in seen:
            raise ValueError(f"invalid or duplicate label name: {name}")
        seen.add(name.casefold())
        if not re.fullmatch(r"[0-9a-fA-F]{6}", label["color"]):
            raise ValueError(f"invalid color for {name}")
        if not isinstance(label["description"], str) or len(label["description"]) > 100:
            raise ValueError(f"invalid description for {name}")
    canonical = {"needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"}
    if not canonical <= seen:
        raise ValueError("missing canonical triage labels")
    return seen


def check_template(text, label_names):
    match = re.match(r"\A---\n(.*?)\n---\n", text, re.S)
    if not match:
        raise ValueError("missing template frontmatter")
    data = load_yaml(match[1])
    for key in ("name", "about"):
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise ValueError(f"missing template {key}")
    labels = data.get("labels")
    if not isinstance(labels, list) or any(label not in label_names for label in labels):
        raise ValueError("template labels must be a list of known labels")
    if "needs-triage" not in labels:
        raise ValueError("new issues must have needs-triage")


def check_workflow(data):
    if not isinstance(data, dict):
        raise ValueError("workflow must be a mapping")
    events = data.get("on", {})
    if not isinstance(events, dict) or "pull_request" not in events:
        raise ValueError("CI must run on every pull request")
    if set(events) - {"pull_request", "push", "workflow_dispatch"}:
        raise ValueError("CI has an unexpected or privileged trigger")
    if events["pull_request"] not in (None, {}):
        raise ValueError("required PR CI must not have event or path filters")
    if data.get("permissions") != {"contents": "read"}:
        raise ValueError("CI must use contents: read")
    jobs = data.get("jobs", {})
    if not isinstance(jobs, dict) or "checks" not in jobs:
        raise ValueError("CI must expose a checks job")
    if jobs["checks"].get("name") != "checks" or "if" in jobs["checks"]:
        raise ValueError("required checks job must have a stable name and run unconditionally")
    for job in jobs.values():
        if job.get("runs-on") != "ubuntu-24.04":
            raise ValueError("CI must use the approved GitHub-hosted runner")
        timeout = job.get("timeout-minutes")
        if type(timeout) is not int or not 1 <= timeout <= 30:
            raise ValueError("CI jobs need a timeout of 1-30 minutes")
        if "permissions" in job and job["permissions"] != {"contents": "read"}:
            raise ValueError("CI jobs must not expand token permissions")
        steps = job.get("steps", [])
        if not isinstance(steps, list) or not steps:
            raise ValueError("CI jobs need steps")
        for step in steps:
            action = step.get("uses")
            if action and not re.fullmatch(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}", action):
                raise ValueError("external actions must be pinned to a full commit SHA")
            if action and action.startswith("actions/checkout@"):
                if step.get("with", {}).get("persist-credentials") is not False:
                    raise ValueError("checkout must not persist credentials")


def check_path(path):
    forbidden = {".worktrees", ".venv", "venv", "__pycache__", "node_modules"}
    if forbidden.intersection(path.parts) or path.suffix == ".pyc" or path.name == ".DS_Store":
        return ["generated or local-only path must not be tracked"]
    if path.name.startswith(".env") and path.name not in {".env.example", ".env.sample"}:
        return ["environment credential files must not be tracked"]
    return []


def check_repo(root, paths):
    errors = []
    labels = check_labels(load_json((root / ".github/labels.json").read_text()))
    text_suffixes = {".md", ".json", ".yml", ".yaml", ".py", ".txt"}
    text_names = {".gitignore", ".editorconfig", ".python-version", "TEMPLATE_LICENSE", "LICENSE"}
    for relative in paths:
        path = root / relative
        problems = check_path(relative)
        try:
            if path.suffix in text_suffixes or path.name in text_names:
                text = path.read_bytes().decode("utf-8")
                problems += check_text(text)
                if path.suffix == ".md":
                    problems += check_markdown(root, path, text)
                    if relative.parent == Path(".github/ISSUE_TEMPLATE"):
                        check_template(text, labels)
                elif path.suffix == ".json":
                    load_json(text)
                elif path.suffix in {".yaml", ".yml"}:
                    data = load_yaml(text)
                    if relative == Path(".github/workflows/ci.yml"):
                        check_workflow(data)
                    elif relative == Path(".github/ISSUE_TEMPLATE/config.yml"):
                        if data.get("blank_issues_enabled") is not True:
                            raise ValueError("keep blank issues available")
        except (ValueError, TypeError, KeyError, AttributeError, OSError, yaml.YAMLError) as error:
            problems.append(str(error))
        errors.extend(f"{relative}: {problem}" for problem in problems)
    return errors


def main():
    root = Path(__file__).resolve().parents[1]
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    paths = [Path(name) for name in tracked if name]
    try:
        errors = check_repo(root, paths)
    except (ValueError, KeyError, TypeError, OSError) as error:
        errors = [str(error)]
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Repository checks passed ({len(paths)} tracked files).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
