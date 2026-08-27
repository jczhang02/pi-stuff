import { type Static, Type } from "typebox";

export const WEB_SEARCH_PARAMETERS = Type.Object({
	query: Type.Optional(Type.String({ maxLength: 1_000, minLength: 1 })),
	queries: Type.Optional(Type.Array(Type.String({ maxLength: 1_000, minLength: 1 }), { maxItems: 4, minItems: 1 })),
	numResults: Type.Optional(Type.Integer({ maximum: 20, minimum: 1 })),
	recencyFilter: Type.Optional(
		Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")]),
	),
	domainFilter: Type.Optional(Type.Array(Type.String({ maxLength: 253, minLength: 1 }), { maxItems: 20 })),
	provider: Type.Optional(
		Type.Union([
			Type.String({ maxLength: 64, minLength: 1 }),
			Type.Array(Type.String({ maxLength: 64, minLength: 1 }), { maxItems: 8, minItems: 1 }),
		]),
	),
});

export const WEB_FETCH_PARAMETERS = Type.Object({
	url: Type.Optional(Type.String({ maxLength: 8_192, minLength: 1 })),
	urls: Type.Optional(Type.Array(Type.String({ maxLength: 8_192, minLength: 1 }), { maxItems: 10, minItems: 1 })),
	mode: Type.Optional(Type.Union([Type.Literal("readable"), Type.Literal("raw")])),
});

export const WEB_CONTENT_PARAMETERS = Type.Object({
	responseId: Type.String({ maxLength: 256, minLength: 1 }),
	query: Type.Optional(Type.String({ maxLength: 1_000, minLength: 1 })),
	queryIndex: Type.Optional(Type.Integer({ maximum: 100, minimum: 0 })),
	url: Type.Optional(Type.String({ maxLength: 8_192, minLength: 1 })),
	urlIndex: Type.Optional(Type.Integer({ maximum: 100, minimum: 0 })),
	offset: Type.Optional(Type.Integer({ minimum: 0 })),
	limit: Type.Optional(Type.Integer({ maximum: 30_000, minimum: 1 })),
	findText: Type.Optional(
		Type.Union([
			Type.String({ maxLength: 500, minLength: 1 }),
			Type.Array(Type.String({ maxLength: 500, minLength: 1 }), { maxItems: 10, minItems: 1 }),
		]),
	),
	findMode: Type.Optional(
		Type.Union([Type.Literal("exact"), Type.Literal("case-insensitive"), Type.Literal("fuzzy")]),
	),
});

export type WebSearchParams = Static<typeof WEB_SEARCH_PARAMETERS>;
export type WebFetchParams = Static<typeof WEB_FETCH_PARAMETERS>;
export type WebContentParams = Static<typeof WEB_CONTENT_PARAMETERS>;
