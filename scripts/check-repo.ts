import {execFileSync} from 'node:child_process';
import {existsSync, realpathSync} from 'node:fs';
import {dirname, extname, isAbsolute, relative, resolve, sep} from 'node:path';
import {Effect} from 'effect';
import {
  IssueConfig,
  LabelInput,
  PackageInput,
  Template,
  WorkflowInput,
} from './contracts';
import {decodeJson, decodeYaml, loadJson, loadYaml, readText} from './parse';
import {
  checkIssueConfig,
  checkLabels,
  checkTemplateData,
  checkToolchain,
  checkWorkflow,
} from './repo-policy';
import {
  FENCE,
  splitLines,
  trimEndWhitespace,
  trimWhitespace,
  WHITESPACE,
} from './text';

export {loadJson, loadYaml} from './parse';
export {checkLabels, checkToolchain, checkWorkflow} from './repo-policy';

export function checkText(text: string): string[] {
  const errors: string[] = [];
  if (text.includes('\r')) errors.push('use LF line endings');
  if (text && !text.endsWith('\n')) errors.push('missing final newline');
  for (const [index, line] of splitLines(text).entries()) {
    if (trimEndWhitespace(line) !== line)
      errors.push(`line ${index + 1}: trailing whitespace`);
    if (line.includes('\t'))
      errors.push(`line ${index + 1}: use spaces, not tabs`);
  }
  return errors;
}
function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
export function checkMarkdown(
  root: string,
  path: string,
  text: string,
): string[] {
  const errors: string[] = [];
  const prose: string[] = [];
  let fence: string | undefined;
  for (const [index, line] of splitLines(text).entries()) {
    const marker = FENCE.exec(line);
    if (marker) {
      const run = marker[1]!;
      if (!fence) fence = run;
      else if (
        run[0] === fence[0] &&
        run.length >= fence.length &&
        !trimWhitespace(marker[2]!)
      )
        fence = undefined;
      continue;
    }
    if (!fence) {
      if (new RegExp(`^#{1,6}[^#${WHITESPACE}]`).test(line))
        errors.push(`line ${index + 1}: add a space after heading markers`);
      prose.push(line);
    }
  }
  if (fence) errors.push('unclosed fenced code block');
  const body = prose.join('\n');
  // File targets only: this is not a full Markdown renderer or anchor checker.
  const links = [
    ...body.matchAll(/!?\[[^\]\n]*\]\(\s*<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g),
    ...body.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm),
    ...body.matchAll(/(?:href|src)=["']([^"']+)["']/g),
  ].map(match => match[1]!);
  const canonicalRoot = realpathSync(root);
  for (const link of links) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('//')) continue;
    const rawPath = link.split(/[?#]/, 1)[0]!;
    if (!rawPath) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      errors.push(`invalid local link encoding: ${link}`);
      continue;
    }
    const target = decoded.startsWith('/')
      ? resolve(root, decoded.slice(1))
      : resolve(dirname(path), decoded);
    // Resolve existing symlinks too: a repository-local path must not point outside the repository.
    const canonicalTarget = existsSync(target) ? realpathSync(target) : target;
    if (!inside(canonicalRoot, canonicalTarget))
      errors.push(`local link escapes the repository: ${link}`);
    else if (!existsSync(target))
      errors.push(`missing local link target: ${link}`);
  }
  return errors;
}
export function checkTemplate(text: string, labelNames: Set<string>): void {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error('missing template frontmatter');
  checkTemplateData(
    Effect.runSync(decodeYaml(match[1]!, Template)),
    labelNames,
  );
}
export function checkPath(path: string): string[] {
  const parts = path.split(/[\\/]/);
  const name = parts.at(-1)!;
  if (
    parts.some(part =>
      [
        '.beads',
        '.worktrees',
        '.venv',
        'venv',
        '__pycache__',
        'node_modules',
      ].includes(part),
    ) ||
    path.endsWith('.pyc') ||
    name === '.DS_Store'
  )
    return ['generated or local-only path must not be tracked'];
  if (
    name.startsWith('.env') &&
    !['.env.example', '.env.sample'].includes(name)
  )
    return ['environment credential files must not be tracked'];
  return [];
}
export function checkRepo(root: string, paths: string[]): string[] {
  const errors: string[] = [];
  // Bootstrap labels as readFileSync(..., 'utf8') did. The collection pass
  // below reports invalid encoding with the file prefix, alongside other errors.
  const labels = checkLabels(
    Effect.runSync(
      Effect.flatMap(
        readText(resolve(root, '.github/labels.json'), {ignoreBOM: true}),
        text => decodeJson(text, LabelInput),
      ),
    ),
  );
  const textSuffixes = new Set([
    '.md',
    '.json',
    '.yml',
    '.yaml',
    '.ts',
    '.py',
    '.txt',
  ]);
  const textNames = new Set([
    '.gitignore',
    '.editorconfig',
    'bun.lock',
    'TEMPLATE_LICENSE',
    'LICENSE',
  ]);
  for (const path of paths) {
    const fullPath = resolve(root, path);
    const problems = checkPath(path);
    try {
      if (
        textSuffixes.has(extname(path)) ||
        textNames.has(path.split('/').at(-1)!)
      ) {
        const text = Effect.runSync(readText(fullPath));
        const upstreamSource =
          path.startsWith('tools/oxlint/anti-slop/') && path.endsWith('.ts');
        if (!upstreamSource) problems.push(...checkText(text));
        if (path.endsWith('.md')) {
          problems.push(...checkMarkdown(root, fullPath, text));
          if (dirname(path) === '.github/ISSUE_TEMPLATE')
            checkTemplate(text, labels);
        } else if (path.endsWith('.json')) {
          if (path === 'package.json')
            checkToolchain(Effect.runSync(decodeJson(text, PackageInput)));
          else loadJson(text);
        } else if (/\.ya?ml$/.test(path)) {
          if (path === '.github/workflows/ci.yml')
            checkWorkflow(Effect.runSync(decodeYaml(text, WorkflowInput)));
          else if (path === '.github/ISSUE_TEMPLATE/config.yml')
            checkIssueConfig(Effect.runSync(decodeYaml(text, IssueConfig)));
          else loadYaml(text);
        }
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : 'invalid file');
    }
    errors.push(...problems.map(problem => `${path}: ${problem}`));
  }
  return errors;
}
export function main(): number {
  const root = resolve(import.meta.dir, '..');
  try {
    const paths = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean);
    const errors = checkRepo(root, paths);
    if (errors.length) {
      console.error(errors.join('\n'));
      return 1;
    }
    console.log(`Repository checks passed (${paths.length} tracked files).`);
    return 0;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Repository check failed.',
    );
    return 1;
  }
}
if (import.meta.main) process.exitCode = main();
