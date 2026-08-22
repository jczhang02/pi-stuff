import { Type } from "typebox";
import { Check } from "typebox/value";

export const CONTEXT_COMPACTION_BYPASSED_EVENT = "@jczhang02/pi-stuff-context/compaction-bypassed/v1";

export interface ContextCompactionBypassedEvent {
	readonly schemaVersion: 1;
	readonly sessionManager: object;
	readonly source: "magic-context";
}

const CONTEXT_COMPACTION_BYPASSED_SCHEMA = Type.Object(
	{
		schemaVersion: Type.Literal(1),
		sessionManager: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Array(Type.Unknown())]),
		source: Type.Literal("magic-context"),
	},
	{ additionalProperties: true },
);

export function isContextCompactionBypassedEvent<Value>(value: Value): value is Value & ContextCompactionBypassedEvent {
	return Check(CONTEXT_COMPACTION_BYPASSED_SCHEMA, value);
}
