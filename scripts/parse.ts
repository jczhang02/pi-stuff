import {readFileSync} from 'node:fs';
import {Data, Effect, Result, Schema} from 'effect';
import {parseDocument} from 'yaml';

export class InputError extends Data.TaggedError('InputError')<{
  message: string;
}> {}

export function readText(path: string) {
  return Effect.try({
    try: () =>
      new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(
        readFileSync(path),
      ),
    catch: () => new InputError({message: 'Cannot read UTF-8 input.'}),
  });
}

export function asRecord(
  value: Schema.Json | undefined,
  message = 'expected a mapping',
) {
  const result = Schema.decodeUnknownResult(Schema.JsonObject)(value);
  if (Result.isFailure(result)) throw new InputError({message});
  return result.success;
}

export function loadYaml(text: string): Schema.Json {
  const document = parseDocument(text, {version: '1.2', uniqueKeys: true});
  const problems = [...document.errors, ...document.warnings];
  if (problems.length)
    throw new InputError({
      message: problems.map(error => error.message).join('; '),
    });
  return Schema.decodeUnknownSync(Schema.Json)(
    document.toJS({maxAliasCount: 100}),
  );
}

export function loadJson(text: string): Schema.Json {
  // Validate JSON syntax, then reject duplicate decoded keys using YAML's JSON schema.
  const value = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text));
  const document = parseDocument(text, {schema: 'json', uniqueKeys: true});
  if (document.errors.length)
    throw new InputError({
      message: document.errors.map(error => error.message).join('; '),
    });
  return value;
}
