"""Validate PR evidence declarations; never execute or fetch PR-supplied text."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys


HEADINGS = (
    "Behavior and impact",
    "Approach and decisions",
    "Verification and reproduction",
    "Risk and review",
    "Related work",
)
FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})(.*)$")


def lines_with_fences(text):
    fence = None
    for line in text.splitlines():
        marker = FENCE.match(line)
        if marker:
            run, rest = marker.groups()
            if fence is None:
                fence = run
            elif run[0] == fence[0] and len(run) >= len(fence) and not rest.strip():
                fence = None
            yield line, True
        else:
            yield line, fence is not None


def substantive(text):
    for line in text.splitlines():
        if FENCE.match(line):
            continue
        line = re.sub(r"^\s*(?:[-*]\s+(?:\[[ xX]\]\s*)?)?", "", line).strip()
        if not line or re.fullmatch(r"[\W_]+", line):
            continue
        if re.fullmatch(r"[\w /-]+:\s*", line):
            continue
        if re.fullmatch(r"(?:N/?A|none|TODO|TBD|not applicable)[.!]?", line, re.I):
            continue
        return True
    return False


def check_body(body):
    if not isinstance(body, str):
        return ["PR body must be text"]
    # Comments are template guidance, not submitted evidence.
    body = re.sub(r"<!--.*?(?:-->|\Z)", "", body, flags=re.S)
    sections = {}
    current = None
    errors = []
    for line, fenced in lines_with_fences(body):
        heading = re.fullmatch(r"###\s+(.+?)\s*", line) if not fenced else None
        if heading:
            current = heading.group(1)
            if current in sections:
                errors.append("duplicate PR section")
            sections[current] = []
        elif current is not None:
            sections[current].append(line)
    for name in HEADINGS:
        if name not in sections or not substantive("\n".join(sections[name])):
            errors.append(f"missing or empty section: {name}")

    review_text = "\n".join(sections.get("Risk and review", []))
    review = "\n".join(line for line, fenced in lines_with_fences(review_text) if not fenced)
    values = {}
    for field in ("Risk level", "Independent review", "Review evidence"):
        matches = re.findall(rf"^{re.escape(field)}:[ \t]*([^\n]*)$", review, flags=re.M)
        if len(matches) != 1:
            errors.append(f"include exactly one {field} field")
        else:
            values[field] = matches[0].strip()
    risk = values.get("Risk level")
    status = values.get("Independent review")
    if risk not in {"low", "high"}:
        errors.append("Risk level must be low or high")
    if status not in {"completed", "not-required", "waived"}:
        errors.append("ready PRs need completed, not-required, or waived independent review")
    if risk == "high" and status not in {"completed", "waived"}:
        errors.append("high-risk PRs need completed review or an explicitly authorized waiver")
    if not substantive(values.get("Review evidence", "")):
        errors.append("Review evidence must explain the review, exemption, or authorized waiver")
    return errors


def check_event(event):
    if not isinstance(event, dict) or not isinstance(event.get("pull_request"), dict):
        return ["event must contain a pull_request object"]
    pr = event["pull_request"]
    if type(pr.get("draft")) is not bool:
        return ["pull_request.draft must be a boolean"]
    if pr["draft"]:
        return []
    return check_body(pr.get("body"))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--body-file", type=Path, help="check a ready PR description locally")
    args = parser.parse_args(argv)
    try:
        if args.body_file:
            errors = check_body(args.body_file.read_text(encoding="utf-8"))
        elif os.environ.get("GITHUB_EVENT_NAME") == "pull_request":
            event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
            errors = check_event(event)
        else:
            print("PR evidence: not applicable to this event.")
            return 0
    except (OSError, KeyError, ValueError) as error:
        # Report the error class, not arbitrary payload text or credential-bearing paths.
        print(f"Cannot read PR evidence input ({type(error).__name__}).", file=sys.stderr)
        return 1
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("PR evidence structure passed (or PR is draft); claims still require review.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
