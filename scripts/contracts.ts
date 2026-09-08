import {Effect, Option, Record, Schema, SchemaGetter} from 'effect';

// Keep invalid consumed fields distinct from missing fields. Policy checks report
// them in their historical order, rather than Schema's traversal order.
function invalidAsNull<S extends Schema.Top>(schema: S) {
  return Schema.NullOr(schema).pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(null))),
  );
}
const field = <S extends Schema.Top>(schema: S) =>
  Schema.mutableKey(Schema.optionalKey(invalidAsNull(schema)));
const strings = Schema.mutable(Schema.Array(Schema.String));

// Presence, not truthiness, is the security contract for forbidden CI fields.
const Presence = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.Literal(true), {
    decode: SchemaGetter.transform((): true => true),
    encode: SchemaGetter.forbidden(
      () => 'Presence is a decode-only projection',
    ),
  }),
);
const present = Schema.mutableKey(Schema.optionalKey(Presence));

const Label = Schema.Struct({
  name: field(Schema.String),
  color: field(Schema.String),
  description: field(Schema.String),
});
export const Labels = Schema.mutable(Schema.Array(invalidAsNull(Label)));
export const LabelInput = invalidAsNull(Labels);
export const Template = invalidAsNull(
  Schema.Struct({
    name: field(Schema.String),
    about: field(Schema.String),
    labels: field(strings),
  }),
);

// These records retain arbitrary key names because exact key sets are policy.
// Values have narrow consumer meanings; unrelated YAML values become null.
export const Permissions = Schema.Record(
  Schema.String,
  Schema.mutableKey(invalidAsNull(Schema.String)),
);
const Trigger = Schema.Record(
  Schema.String,
  Schema.mutableKey(invalidAsNull(strings)),
);
export const ActionInputs = Schema.Record(
  Schema.String,
  Schema.mutableKey(
    invalidAsNull(Schema.Union([Schema.String, Schema.Boolean])),
  ),
);
const Step = Schema.Struct({
  uses: field(Schema.String),
  run: field(Schema.String),
  with: field(ActionInputs),
  if: present,
  'continue-on-error': present,
  env: present,
});
const Job = Schema.Struct({
  name: field(Schema.String),
  'runs-on': field(Schema.String),
  'timeout-minutes': field(Schema.Number),
  if: present,
  'continue-on-error': present,
  permissions: field(Permissions),
  steps: field(Schema.mutable(Schema.Array(invalidAsNull(Step)))),
});
export const Workflow = Schema.Struct({
  on: field(
    Schema.Record(Schema.String, Schema.mutableKey(invalidAsNull(Trigger))),
  ),
  permissions: field(Permissions),
  jobs: field(
    Schema.Record(Schema.String, Schema.mutableKey(invalidAsNull(Job))),
  ),
});
export const WorkflowInput = invalidAsNull(Workflow);

export const REQUIRED_SCRIPTS = {
  format: 'bun --bun oxfmt --write .',
  'format:check': 'bun --bun oxfmt --check .',
  lint: 'bun --bun oxlint --deny-warnings --disable-nested-config',
  typecheck: 'bun --bun tsc --noEmit',
  test: 'bun test',
  'check:repo': 'bun scripts/check-repo.ts',
  'check:pr': 'bun scripts/check-pr.ts',
  check:
    'bun run format:check && bun run lint && bun run typecheck && bun run test && bun run check:repo',
};
export const Package = Schema.Struct({
  packageManager: field(Schema.String),
  engines: field(Schema.Struct({bun: field(Schema.String)})),
  scripts: field(
    Schema.Struct(Record.map(REQUIRED_SCRIPTS, () => field(Schema.String))),
  ),
  dependencies: field(Schema.Struct({effect: field(Schema.String)})),
  devDependencies: field(
    Schema.Record(
      Schema.String,
      Schema.mutableKey(invalidAsNull(Schema.String)),
    ),
  ),
});
export const PackageInput = invalidAsNull(Package);
export const IssueConfig = invalidAsNull(
  Schema.Struct({blank_issues_enabled: field(Schema.Boolean)}),
);
export const BodyInput = invalidAsNull(Schema.String);
export const PREvent = invalidAsNull(
  Schema.Struct({
    pull_request: field(
      Schema.Struct({
        draft: field(Schema.Boolean),
        body: field(Schema.String),
      }),
    ),
  }),
);
