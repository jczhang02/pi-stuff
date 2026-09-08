"""PR evidence checks exercise public text/event and command-line interfaces."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from check_pr import check_body, check_event

ROOT = Path(__file__).resolve().parents[1]
BODY = """### Behavior and impact
Before: contributor steps were unclear. After: the guide names the existing checks.
No runtime behavior changes.

### Approach and decisions
Keep commands in the contribution guide rather than duplicating them in each template.

### Verification and reproduction
Run `python scripts/check_repo.py` after installing the pinned dependencies.
Observed: repository checks passed. Expected: exit 0 and no missing local links.
Tests were added after implementation; no TDD claim.

### Risk and review
Risk level: low
Independent review: not-required
Review evidence: Documentation-only clarification; no interface or workflow gate changes.

### Related work
No task: this is a small documentation clarification.
"""


class PREvidenceTest(unittest.TestCase):
    def test_complete_body_passes(self):
        self.assertEqual(check_body(BODY), [])

    def test_template_alone_fails(self):
        template = (ROOT / ".github/pull_request_template.md").read_text()
        self.assertTrue(check_body(template))

    def test_empty_or_nontext_body_fails(self):
        for body in ("", None, {}, 42):
            with self.subTest(body=body):
                self.assertTrue(check_body(body))

    def test_missing_section_fails(self):
        self.assertTrue(check_body(BODY.replace("### Approach and decisions", "### Other notes")))

    def test_duplicate_section_fails(self):
        errors = check_body(BODY + "\n### Related work\nAnother task.\n")
        self.assertIn("duplicate PR section", errors)

    def test_comments_do_not_supply_evidence(self):
        self.assertTrue(check_body("<!--\n" + BODY + "\n-->"))

    def test_fenced_headings_do_not_supply_sections(self):
        self.assertTrue(check_body("```markdown\n" + BODY + "\n```"))

    def test_nested_fences_do_not_supply_sections(self):
        self.assertTrue(check_body("````markdown\n```text\n" + BODY + "\n```\n````"))

    def test_bare_placeholders_fail(self):
        for placeholder in ("N/A", "TODO", "TBD", "- [ ]", "```text\n```", "GitHub issue:\nBeads ID:"):
            body = BODY[:BODY.index("### Related work")] + "### Related work\n" + placeholder
            with self.subTest(placeholder=placeholder):
                self.assertTrue(check_body(body))

    def test_explained_limitation_passes(self):
        body = BODY.replace("No task: this is a small documentation clarification.", "N/A: explicitly authorized bootstrap work, with no prior task.")
        self.assertEqual(check_body(body), [])

    def test_high_risk_needs_independent_review(self):
        self.assertTrue(check_body(BODY.replace("Risk level: low", "Risk level: high")))

    def test_completed_high_risk_review_passes(self):
        body = BODY.replace("Risk level: low", "Risk level: high").replace("Independent review: not-required", "Independent review: completed")
        body = body.replace("Documentation-only clarification; no interface or workflow gate changes.", "Separate reviewer inspected base abc123 to head def456; one blocking issue fixed and follow-up reviewed. See linked review report.")
        self.assertEqual(check_body(body), [])

    def test_multiline_review_evidence_passes(self):
        body = BODY.replace("Review evidence: Documentation-only clarification; no interface or workflow gate changes.", "Review evidence:\nDocumentation-only clarification.\nNo interface or workflow gate changes.")
        self.assertEqual(check_body(body), [])

    def test_multiline_evidence_can_precede_other_declarations(self):
        body = BODY.replace("Risk level: low\nIndependent review: not-required\nReview evidence: Documentation-only clarification; no interface or workflow gate changes.", "Review evidence:\nDocumentation-only clarification.\nRisk level: low\nIndependent review: not-required")
        self.assertEqual(check_body(body), [])

    def test_higher_level_heading_ends_section(self):
        prefix = BODY[:BODY.index("### Related work")]
        for heading in ("# Appendix", "## Appendix"):
            with self.subTest(heading=heading):
                self.assertTrue(check_body(prefix + "### Related work\n\n" + heading + "\nUnrelated text.\n"))

    def test_subheading_alone_is_not_evidence(self):
        prefix = BODY[:BODY.index("### Related work")]
        self.assertTrue(check_body(prefix + "### Related work\n\n#### Task links\n"))
        self.assertEqual(check_body(prefix + "### Related work\n\n#### Task links\nRefs #2.\n"), [])

    def test_declared_waiver_passes_but_authorization_is_not_proven(self):
        body = BODY.replace("Risk level: low", "Risk level: high").replace("Independent review: not-required", "Independent review: waived")
        body = body.replace("Documentation-only clarification; no interface or workflow gate changes.", "Maintainer explicitly waived review in the linked task comment; this validator cannot authenticate that claim.")
        self.assertEqual(check_body(body), [])

    def test_pending_review_fails_when_ready(self):
        self.assertTrue(check_body(BODY.replace("Independent review: not-required", "Independent review: pending")))

    def test_unknown_risk_fails(self):
        self.assertTrue(check_body(BODY.replace("Risk level: low", "Risk level: maybe")))

    def test_empty_review_field_does_not_consume_next_line(self):
        self.assertTrue(check_body(BODY.replace("Risk level: low", "Risk level:")))

    def test_duplicate_review_field_fails(self):
        self.assertTrue(check_body(BODY.replace("Risk level: low", "Risk level: low\nRisk level: high")))

    def test_review_fields_inside_fences_do_not_count(self):
        start = BODY.index("Risk level:")
        end = BODY.index("### Related work")
        body = BODY[:start] + "```text\n" + BODY[start:end] + "```\n" + BODY[end:]
        self.assertTrue(check_body(body))

    def test_draft_can_be_incomplete(self):
        self.assertEqual(check_event({"pull_request": {"draft": True, "body": None}}), [])

    def test_ready_event_checks_body(self):
        self.assertEqual(check_event({"pull_request": {"draft": False, "body": BODY}}), [])
        self.assertTrue(check_event({"pull_request": {"draft": False, "body": None}}))

    def test_malformed_events_fail(self):
        for event in ([], {}, {"pull_request": []}, {"pull_request": {"draft": "false", "body": BODY}}):
            with self.subTest(event=event):
                self.assertTrue(check_event(event))

    def run_cli(self, directory, event, name="pull_request"):
        payload = Path(directory) / "event.json"
        payload.write_text(json.dumps(event))
        env = {**os.environ, "GITHUB_EVENT_PATH": str(payload), "GITHUB_EVENT_NAME": name}
        return subprocess.run([sys.executable, str(ROOT / "scripts/check_pr.py")], env=env, capture_output=True, text=True)

    def test_cli_reads_event_and_reports_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            good = self.run_cli(directory, {"pull_request": {"draft": False, "body": BODY}})
            bad = self.run_cli(directory, {"pull_request": {"draft": False, "body": ""}})
            self.assertEqual(good.returncode, 0, good.stderr)
            self.assertEqual(bad.returncode, 1)
            self.assertIn("missing or empty section", bad.stderr)

    def test_cli_never_executes_body(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "must-not-exist"
            body = BODY + f"\n$(touch {marker})\n`touch {marker}`\n${{{{ secrets.GITHUB_TOKEN }}}}\n"
            result = self.run_cli(directory, {"pull_request": {"draft": False, "body": body}})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(marker.exists())
            self.assertNotIn("GITHUB_TOKEN", result.stdout + result.stderr)

    def test_cli_skips_non_pr_events(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_cli(directory, {}, name="push")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("not applicable", result.stdout)

    def test_cli_accepts_body_file(self):
        with tempfile.TemporaryDirectory() as directory:
            body = Path(directory) / "body.md"
            body.write_text(BODY)
            result = subprocess.run([sys.executable, str(ROOT / "scripts/check_pr.py"), "--body-file", str(body)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
