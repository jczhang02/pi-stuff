import {Schema} from 'effect';

// Mutable, schema-validated fixtures allow tests to introduce one invalid policy at a time.
const mutable = Schema.mutableKey;
const optional = Schema.optionalKey;
const strings = Schema.mutable(Schema.Array(Schema.String));
const inputs = Schema.Record(Schema.String, mutable(Schema.Json));
export const LabelsFixture = Schema.mutable(
  Schema.Array(
    Schema.Struct({
      name: mutable(Schema.String),
      color: mutable(Schema.String),
      description: mutable(Schema.String),
    }),
  ),
);
const Step = Schema.Struct({
  uses: mutable(optional(Schema.String)),
  run: mutable(optional(Schema.String)),
  with: mutable(optional(inputs)),
  if: mutable(optional(Schema.String)),
  env: mutable(optional(Schema.Record(Schema.String, Schema.String))),
});
export const WorkflowFixture = Schema.Struct({
  on: Schema.Struct({
    pull_request: mutable(
      Schema.Struct({
        types: mutable(optional(strings)),
        paths: mutable(optional(strings)),
      }),
    ),
    pull_request_target: mutable(optional(Schema.Null)),
  }),
  permissions: Schema.Struct({contents: mutable(Schema.String)}),
  jobs: Schema.Struct({
    checks: Schema.Struct({
      name: mutable(Schema.String),
      'runs-on': mutable(Schema.String),
      'timeout-minutes': mutable(optional(Schema.Number)),
      if: mutable(optional(Schema.String)),
      'continue-on-error': mutable(optional(Schema.Boolean)),
      steps: mutable(Schema.mutable(Schema.Array(Step))),
    }),
  }),
});
export const PackageFixture = Schema.Struct({
  name: Schema.String,
  private: Schema.Boolean,
  type: Schema.String,
  packageManager: Schema.String,
  engines: Schema.Struct({bun: Schema.String}),
  scripts: Schema.Record(Schema.String, Schema.String),
  dependencies: optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.Record(Schema.String, Schema.String),
});
