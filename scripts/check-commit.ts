import {Effect, Schema} from 'effect';
import {decodeEventJson, InputError, readText} from './parse';
import {git} from './git';

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ObjectId = Schema.String.check(Schema.isPattern(OID));
const CommitPR = Schema.Struct({
  pull_request: Schema.Struct({
    title: Schema.String,
    base: Schema.Struct({sha: ObjectId}),
    head: Schema.Struct({sha: ObjectId}),
  }),
});
const CommitPush = Schema.Struct({
  ref: Schema.Literal('refs/heads/main'),
  before: ObjectId,
  after: ObjectId,
});
const Dispatch = Schema.Struct({ref: Schema.String});

// This checks syntax, not whether a type/scope is a noun, a change is really
// breaking, or a description is accurate. Body text otherwise stays free-form.
export function checkMessage(input: string): string[] {
  const normalized = input.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const header = lines[0] ?? '';
  const match = /^([\p{Ll}]+)(?:\(([^()\r\n]+)\))?!?: (.*)$/u.exec(header);
  const errors: string[] = [];
  if (
    !match ||
    !match[3]?.trim() ||
    (match[2] !== undefined && !match[2].trim())
  )
    errors.push(
      'Use a lowercase type, optional scope/!, and ": " followed by a description.',
    );
  if (
    [...normalized].some(character => {
      const code = character.charCodeAt(0);
      return (
        (code < 32 && character !== '\t' && character !== '\n') || code === 127
      );
    })
  )
    errors.push('Commit messages must not contain control characters.');
  if (lines.length > 1 && lines[1]!.trim())
    errors.push('Separate the header and body/footer with a blank line.');
  return errors;
}

function fail(message: string) {
  return Effect.fail(new InputError({message}));
}

function requireCommit(directory: string, oid: string) {
  return Effect.gen(function* () {
    if (!OID.test(oid) || /^0+$/.test(oid))
      return yield* fail('Expected a nonzero full commit object ID.');
    if ((yield* git(directory, ['cat-file', '-t', oid])).trim() !== 'commit')
      return yield* fail('History must contain the requested commit object.');
  });
}

function checkCI(directory: string) {
  return Effect.gen(function* () {
    const name = process.env.GITHUB_EVENT_NAME;
    if (!['pull_request', 'push', 'workflow_dispatch'].includes(name ?? ''))
      return yield* fail('Unsupported or privileged GitHub event.');
    const path = process.env.GITHUB_EVENT_PATH;
    if (!path) return yield* fail('Missing GitHub event path.');
    const text = yield* readText(path);
    if (
      (yield* git(directory, [
        'rev-parse',
        '--is-shallow-repository',
      ])).trim() !== 'false'
    )
      return yield* fail(
        'Full Git history is required; shallow repositories are not supported.',
      );

    const errors: string[] = [];
    let head: string;
    let base: string | undefined;
    if (name === 'pull_request') {
      const {pull_request: pr} = yield* decodeEventJson(text, CommitPR);
      if (/[\r\n]/.test(pr.title))
        errors.push('PR title must be a single line.');
      errors.push(...checkMessage(pr.title).map(error => `PR title: ${error}`));
      head = pr.head.sha;
      base = pr.base.sha;
      yield* requireCommit(directory, base);
      yield* requireCommit(directory, head);
      // A behind branch is valid. Require a common ancestor, not base ancestry;
      // exclude everything reachable from base, including merged base history.
      yield* git(directory, ['merge-base', '--all', base, head]);
    } else if (name === 'push') {
      const event = yield* decodeEventJson(text, CommitPush);
      if (event.before.length !== event.after.length)
        return yield* fail('Push object IDs must use the same object format.');
      head = event.after;
      if (!/^0+$/.test(event.before)) {
        base = event.before;
        yield* requireCommit(directory, base);
      }
      yield* requireCommit(directory, head);
    } else {
      const event = yield* decodeEventJson(text, Dispatch);
      const ref = process.env.GITHUB_REF;
      if (
        !ref ||
        !/^refs\/(heads|tags)\/.+/.test(ref) ||
        ![ref, ref.replace(/^refs\/(heads|tags)\//, '')].includes(event.ref)
      )
        return yield* fail('Dispatch ref must match GITHUB_REF.');
      yield* git(directory, ['check-ref-format', ref]);
      head = process.env.GITHUB_SHA ?? '';
      yield* requireCommit(directory, head);
    }

    // A dispatch audits only its selected commit, never an arbitrary historical
    // range. Initial pushes audit all reachable commits; other events use sets.
    const listing =
      name === 'workflow_dispatch'
        ? `${head}\n`
        : yield* git(directory, [
            'rev-list',
            '--reverse',
            head,
            ...(base ? ['--not', base] : []),
          ]);
    const commits = listing.trim() ? listing.trim().split('\n') : [];
    for (const oid of commits) {
      if (!OID.test(oid))
        return yield* fail('Git returned an invalid commit list.');
      const message = yield* git(directory, [
        'show',
        '--no-patch',
        '--format=%B',
        oid,
        '--',
      ]);
      errors.push(
        ...checkMessage(message).map(error => `Commit ${oid}: ${error}`),
      );
    }
    return errors;
  });
}

const USAGE = 'Usage: bun scripts/check-commit.ts [--message-file <path>]';
export function main(args = process.argv.slice(2)): number {
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) {
    console.log(USAGE);
    return 0;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--message-file')) {
    console.error(USAGE);
    return 2;
  }
  const directory = process.cwd();
  const check = args.length
    ? Effect.gen(function* () {
        const text = yield* readText(args[1]!);
        // Check the supplied file, not a guessed Git cleanup mode: commit-msg
        // cannot know every per-invocation cleanup override. Require header-first
        // input; comments below the blank separator are ordinary body text.
        return checkMessage(text);
      })
    : checkCI(directory);
  try {
    const errors = Effect.runSync(check);
    if (errors.length) {
      console.error(errors.join('\n'));
      return 1;
    }
    console.log(
      'Conventional Commit header/body structure passed; footers and semantic intent still require review.',
    );
    return 0;
  } catch {
    // Never print event bodies, commit text, Git stderr, or credential-bearing paths.
    console.error('Cannot check commit input or history (InputError).');
    return 1;
  }
}

if (import.meta.main) process.exitCode = main();
