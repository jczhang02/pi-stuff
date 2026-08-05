import { describe, expect, test } from "bun:test";
import { isLowImpactShellCommand } from "@jczhang02/pi-stuff-tools";

describe("low-impact shell classification", () => {
	const groupable = [
		"pwd",
		'rg -n "needle" src | head -20',
		"ls *.ts",
		"rg \\* package.json",
		"git status --short && git diff --stat",
		"git branch --list 'feature/*'",
		"find . -type f -name '*.ts'",
		"cd packages && ls",
		'cat "$HOME/file"',
		'echo "$(git rev-parse --show-toplevel)"',
		"cat <<'EOF'\n$(not-executed)\nEOF",
		"rg needle . >/dev/null",
		"file package.json",
		"sort package.json",
		"jq . package.json",
		"bd list --status open",
	];

	for (const source of groupable) {
		test(`groups read-only shell: ${source}`, () => {
			expect(isLowImpactShellCommand(source)).toBe(true);
		});
	}

	const standalone = [
		"rm -rf dist",
		"git checkout main",
		"git branch --unset-upstream",
		"git branch -l new-branch",
		"git branch --edit-description",
		"git config --get user.name --unset user.name",
		"git diff --output=diff.txt",
		"git diff --ext-diff",
		"git --paginate status",
		"git grep --open-files-in-pager='sh -c touch-pwned' needle",
		"git cat-file --filters HEAD:package.json",
		"git ls-remote --upload-pack=touch origin",
		"git tag --list -d v1",
		"find . -delete",
		"cat input.txt > copy.txt",
		"cat </dev/tcp/example.com/80",
		'echo "$(touch pwned)"',
		"cat <<EOF\n$(touch pwned)\nEOF",
		"echo <(touch pwned)",
		"rg --pre='sh -c touch-pwned' needle .",
		"rg $OPTIONS needle .",
		"rg *",
		"git diff *",
		"find . -name *",
		"date --se=2025-01-01",
		"sort --compress-program=touch package.json",
		"sort *",
		"sort {--output=sorted.txt,package.json}",
		"sort --out=sorted.txt package.json",
		"sort -osorted.txt package.json",
		"tree -otree.txt",
		"file -C -m custom.magic",
		"file --comp -m custom.magic",
		"jq --run-tests tests.jq",
		"jq *",
		"pgrep --signal TERM fixture",
		"pgrep $OPTIONS fixture",
		"npm install",
		"npm run build",
		"bun test",
		"cargo test",
		"bd update ps-1 --status closed",
		"bd ready --claim",
		"gh issue view 1 --web",
		"printf -v name value",
		"date -s 2025-01-01",
		"date -s2025-01-01",
		"rg needle . &",
		"X=1 pwd",
		"if then",
	];

	for (const source of standalone) {
		test(`keeps consequential or ambiguous shell standalone: ${source}`, () => {
			expect(isLowImpactShellCommand(source)).toBe(false);
		});
	}

	test("rejects non-string and oversized inputs", () => {
		expect(isLowImpactShellCommand(undefined)).toBe(false);
		expect(isLowImpactShellCommand(" ")).toBe(false);
		expect(isLowImpactShellCommand(`echo ${"x".repeat(33 * 1024)}`)).toBe(false);
	});
});
