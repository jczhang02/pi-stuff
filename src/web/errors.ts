import {Schema} from 'effect';

export class WebError extends Schema.TaggedError<WebError>()('WebError', {
  kind: Schema.Literals([
    'input',
    'configuration',
    'authentication',
    'transport',
    'timeout',
    'http',
    'response',
    'content',
    'unavailable',
  ]),
  message: Schema.String,
  status: Schema.optional(Schema.Int),
}) {}
