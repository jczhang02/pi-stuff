import {readFileSync} from 'node:fs';
import type {TextDecoderOptions} from 'node:util';
import {Data, Effect, Result, Schema, SchemaGetter} from 'effect';
import {parseDocument} from 'yaml';

export class InputError extends Data.TaggedError('InputError')<{
  message: string;
}> {}

export function readText(
  path: string,
  decoding: TextDecoderOptions = {fatal: true, ignoreBOM: true},
) {
  return Effect.try({
    try: () => new TextDecoder('utf-8', decoding).decode(readFileSync(path)),
    catch: error =>
      new InputError({
        message:
          error instanceof Error ? error.message : 'Cannot read UTF-8 input.',
      }),
  });
}

export function decodeYaml<T>(
  text: string,
  schema: Schema.ConstraintDecoder<T>,
) {
  return Effect.try({
    try: () => {
      const document = parseDocument(text, {version: '1.2', uniqueKeys: true});
      const problems = [...document.errors, ...document.warnings];
      if (problems.length)
        throw new InputError({
          message: problems.map(error => error.message).join('; '),
        });
      return Schema.decodeUnknownSync(schema)(
        document.toJS({maxAliasCount: 100}),
      );
    },
    catch: error =>
      new InputError({
        message: error instanceof Error ? error.message : 'Invalid YAML input.',
      }),
  });
}

// Events deliberately use native JSON.parse semantics: the last duplicate wins.
export function decodeEventJson<T>(
  text: string,
  schema: Schema.ConstraintDecoder<T>,
) {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(JSON.parse(text)),
    catch: error =>
      error instanceof SyntaxError
        ? error
        : new InputError({
            message:
              error instanceof Error ? error.message : 'Invalid JSON input.',
          }),
  });
}

export function decodeJson<T>(
  text: string,
  schema: Schema.ConstraintDecoder<T>,
) {
  return Effect.try({
    try: () => {
      const decoded = Schema.decodeUnknownResult(schema)(JSON.parse(text));
      // Syntax comes first, then duplicate decoded keys, then consumer errors.
      const document = parseDocument(text, {schema: 'json', uniqueKeys: true});
      if (document.errors.length)
        throw new InputError({
          message: document.errors.map(error => error.message).join('; '),
        });
      if (Result.isFailure(decoded)) throw decoded.failure;
      return decoded.success;
    },
    catch: error =>
      error instanceof SyntaxError
        ? error
        : new InputError({
            message:
              error instanceof Error ? error.message : 'Invalid JSON input.',
          }),
  });
}

// Generic tracked files have no consumed fields. Still materialize YAML to
// enforce the parser's alias limit; do not impose JSON's value restrictions.
const SyntaxOnly = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.Void, {
    decode: SchemaGetter.transform(() => undefined),
    encode: SchemaGetter.forbidden(
      () => 'Syntax validation does not encode data',
    ),
  }),
);
export function loadYaml(text: string): void {
  Effect.runSync(decodeYaml(text, SyntaxOnly));
}
export function loadJson(text: string): void {
  Effect.runSync(decodeJson(text, SyntaxOnly));
}
