"""Regression tests for repository checks, including failing inputs."""

import copy
from pathlib import Path
import tempfile
import unittest

from check_repo import (
    check_labels,
    check_markdown,
    check_path,
    check_repo,
    check_template,
    check_text,
    check_workflow,
    load_json,
    load_yaml,
)

ROOT = Path(__file__).resolve().parents[1]


class RepositoryChecksTest(unittest.TestCase):
    def setUp(self):
        self.labels = load_json((ROOT / ".github/labels.json").read_text())
        self.names = check_labels(self.labels)
        self.workflow = load_yaml((ROOT / ".github/workflows/ci.yml").read_text())

    def test_current_workflow(self):
        check_workflow(self.workflow)

    def test_yaml_keeps_on_key_and_boolean_values(self):
        data = load_yaml("on: push\nenabled: true\ndisabled: false\n")
        self.assertEqual(data, {"on": "push", "enabled": True, "disabled": False})

    def test_duplicate_yaml_keys_fail(self):
        with self.assertRaisesRegex(ValueError, "duplicate YAML key"):
            load_yaml("name: first\nname: second\n")

    def test_duplicate_json_keys_fail(self):
        with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
            load_json('{"name": 1, "name": 2}')

    def test_text_formatting(self):
        self.assertEqual(check_text("Plain text.\n"), [])
        for text in ("no newline", "trailing \n", "tabs\there\n", "windows\r\n"):
            with self.subTest(text=text):
                self.assertTrue(check_text(text))

    def test_duplicate_labels_fail(self):
        self.labels.append(copy.deepcopy(self.labels[0]))
        with self.assertRaisesRegex(ValueError, "duplicate label"):
            check_labels(self.labels)

    def test_invalid_label_color_fails(self):
        self.labels[0]["color"] = "red"
        with self.assertRaisesRegex(ValueError, "invalid color"):
            check_labels(self.labels)

    def test_missing_canonical_label_fails(self):
        with self.assertRaisesRegex(ValueError, "missing canonical"):
            check_labels([])

    def test_templates(self):
        for path in (ROOT / ".github/ISSUE_TEMPLATE").glob("*.md"):
            check_template(path.read_text(), self.names)

    def test_template_unknown_label_fails(self):
        text = "---\nname: Bug\nabout: Report\nlabels: [needs-triage, unknown]\n---\n"
        with self.assertRaisesRegex(ValueError, "known labels"):
            check_template(text, self.names)

    def test_template_missing_triage_fails(self):
        text = "---\nname: Bug\nabout: Report\nlabels: [bug]\n---\n"
        with self.assertRaisesRegex(ValueError, "needs-triage"):
            check_template(text, self.names)

    def test_template_missing_frontmatter_fails(self):
        with self.assertRaisesRegex(ValueError, "frontmatter"):
            check_template("# Bug\n", self.names)

    def test_tracked_local_files_fail(self):
        for name in (".worktrees/topic/file.md", "scripts/__pycache__/file.pyc", ".env", "a/.env.local", "node_modules/x.js"):
            with self.subTest(name=name):
                self.assertTrue(check_path(Path(name)))
        self.assertEqual(check_path(Path(".env.example")), [])

    def test_markdown_file_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "target file.md").write_text("# Target\n")
            text = '[target](target%20file.md#section)\n[web](https://example.com)\n'
            self.assertEqual(check_markdown(root, root / "README.md", text), [])
            errors = check_markdown(root, root / "README.md", "[missing](missing.md)\n")
            self.assertTrue(any("missing local" in error for error in errors))

    def test_html_and_reference_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for text in ('<img src="missing.png">\n', '[guide]: missing.md\n'):
                self.assertTrue(check_markdown(root, root / "README.md", text))

    def test_markdown_links_cannot_escape_repo(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            errors = check_markdown(root, root / "README.md", "[escape](../outside)\n")
            self.assertTrue(any("escapes" in error for error in errors))

    def test_fenced_examples_are_not_links(self):
        text = "```markdown\n[example](not-a-real-file)\n```\n"
        self.assertEqual(check_markdown(ROOT, ROOT / "README.md", text), [])

    def test_unclosed_and_nested_fences(self):
        self.assertTrue(check_markdown(ROOT, ROOT / "README.md", "```python\npass\n"))
        text = "````markdown\n```python\npass\n```\n````\n"
        self.assertEqual(check_markdown(ROOT, ROOT / "README.md", text), [])

    def test_heading_spacing(self):
        self.assertTrue(check_markdown(ROOT, ROOT / "README.md", "##Bad heading\n"))

    def test_pr_filters_fail(self):
        self.workflow["on"]["pull_request"] = {"paths": ["scripts/**"]}
        with self.assertRaisesRegex(ValueError, "filters"):
            check_workflow(self.workflow)

    def test_privileged_trigger_fails(self):
        self.workflow["on"]["pull_request_target"] = None
        with self.assertRaisesRegex(ValueError, "privileged trigger"):
            check_workflow(self.workflow)

    def test_write_permissions_fail(self):
        self.workflow["permissions"]["contents"] = "write"
        with self.assertRaisesRegex(ValueError, "contents: read"):
            check_workflow(self.workflow)

    def test_mutable_action_ref_fails(self):
        self.workflow["jobs"]["checks"]["steps"][0]["uses"] = "actions/checkout@v4"
        with self.assertRaisesRegex(ValueError, "full commit SHA"):
            check_workflow(self.workflow)

    def test_checkout_credentials_fail(self):
        self.workflow["jobs"]["checks"]["steps"][0]["with"]["persist-credentials"] = True
        with self.assertRaisesRegex(ValueError, "persist credentials"):
            check_workflow(self.workflow)

    def test_required_job_cannot_be_conditional(self):
        self.workflow["jobs"]["checks"]["if"] = "false"
        with self.assertRaisesRegex(ValueError, "unconditionally"):
            check_workflow(self.workflow)

    def test_self_hosted_runner_fails(self):
        self.workflow["jobs"]["checks"]["runs-on"] = "self-hosted"
        with self.assertRaisesRegex(ValueError, "GitHub-hosted"):
            check_workflow(self.workflow)

    def test_job_needs_timeout(self):
        del self.workflow["jobs"]["checks"]["timeout-minutes"]
        with self.assertRaisesRegex(ValueError, "timeout"):
            check_workflow(self.workflow)

    def test_checker_collects_file_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".github").mkdir()
            (root / ".github/labels.json").write_text((ROOT / ".github/labels.json").read_text())
            (root / "broken.md").write_text("[broken](missing.md) \n")
            errors = check_repo(root, [Path("broken.md")])
            self.assertTrue(any("trailing whitespace" in error for error in errors))
            self.assertTrue(any("missing local" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
