import { z } from 'zod';

/** Emitted at `session_start`, after the service is published. */
declare const PERMISSIONS_READY_CHANNEL = "permissions:ready";
/** Emitted when a permission request is committed to the active UI prompt path. */
declare const PERMISSIONS_UI_PROMPT_CHANNEL = "permissions:ui_prompt";
/** Emitted after every permission gate resolution. */
declare const PERMISSIONS_DECISION_CHANNEL = "permissions:decision";
/**
 * Payload emitted on `permissions:ready`.
 *
 * Intentionally empty: the channel is a readiness signal. There is no
 * `protocolVersion` — the published types plus package semver define the
 * broadcast contract.
 */
type PermissionsReadyEvent = Record<string, never>;
/**
 * Origin of a UI prompt.
 *
 * Forwarding is orthogonal to origin: a forwarded subagent prompt keeps its
 * original source and is identified by a non-null `forwarding` field, not by a
 * dedicated source value.
 */
type PermissionUiPromptSource = "tool_call" | "skill_input" | "skill_read";
/** Forwarding context, present only when a prompt was forwarded from a non-UI subagent. */
interface ForwardedPromptContext {
    /** Requesting subagent's display name, when known. */
    requesterAgentName: string | null;
    /** Requesting subagent's session id, when known. */
    requesterSessionId: string | null;
}
/**
 * Payload emitted on `permissions:ui_prompt`, immediately before the active
 * user-facing permission UI is shown.
 *
 * Lean by design: `surface`/`value` are the normalized display projection a
 * notification consumer reads; `source` is the origin; `forwarding` is non-null
 * only for forwarded subagent prompts. There is no `protocolVersion` — the
 * published types plus package semver define the broadcast contract, and
 * consumers should read defensively.
 */
interface PermissionUiPromptEvent {
    /** Unique ID for the permission request being prompted. */
    requestId: string;
    /** Prompt origin. */
    source: PermissionUiPromptSource;
    /** Normalized display surface (e.g. "bash", "skill"), when known. */
    surface: string | null;
    /** Normalized display value (command, path, skill name, etc.), when known. */
    value: string | null;
    /** Agent name (when known). */
    agentName: string | null;
    /** Message displayed to the user. */
    message: string;
    /** Forwarding context, or null for a direct prompt. */
    forwarding: ForwardedPromptContext | null;
}
/** How a permission decision was reached. */
type PermissionDecisionResolution = "policy_allow" | "policy_deny" | "session_approved" | "infrastructure_auto_allowed" | "user_approved" | "user_approved_for_session" | "user_denied" | "auto_approved" | "confirmation_unavailable";
/** Payload emitted on `permissions:decision`. */
interface PermissionDecisionEvent {
    /** Permission surface: "bash", "read", "mcp", "skill", "external_directory", etc. */
    surface: string;
    /** The value that was evaluated (command, tool name, skill name, path). */
    value: string;
    /** Final decision. */
    result: "allow" | "deny";
    /** How the decision was reached. */
    resolution: PermissionDecisionResolution;
    /** Which config scope contributed the winning rule (when available). */
    origin: string | null;
    /** Agent name (when known). */
    agentName: string | null;
    /** Matched pattern from the winning rule (when available). */
    matchedPattern: string | null;
}

declare const permissionStateSchema: z.ZodUnion<readonly [z.ZodLiteral<"allow">, z.ZodLiteral<"deny">, z.ZodLiteral<"ask">]>;
/** A permission decision. */
type PermissionState = z.infer<typeof permissionStateSchema>;

/**
 * Provenance of a rule — which source contributed it.
 *
 * Config scopes: "global", "project", "agent", "project-agent".
 * Synthesized:   "builtin" (universal default / evaluate() fallback),
 *                "baseline" (conditional MCP metadata auto-allow).
 * Runtime:       "session" (session approvals).
 * Rewrite:       "yolo" (composition-stage ask→allow rewrite under yolo mode),
 *                "fail-closed" (composition-stage allow→ask floor when an
 *                invalid non-global config scope is detected).
 */
type RuleOrigin = "global" | "project" | "agent" | "project-agent" | "builtin" | "baseline" | "session" | "yolo" | "fail-closed";

/**
 * Execution context of a bash command nested inside a substitution or subshell.
 * Absent for current-shell (top-level) commands.
 */
type BashCommandContext = "command_substitution" | "process_substitution" | "subshell";
interface PermissionCheckResult {
    toolName: string;
    state: PermissionState;
    /** Custom denial reason from a deny-with-reason pattern, when present. */
    reason?: string;
    matchedPattern?: string;
    command?: string;
    target?: string;
    source: "tool" | "bash" | "mcp" | "skill" | "special" | "default" | "session";
    /** Which source contributed the winning rule. */
    origin: RuleOrigin;
    /**
     * Execution context of the offending nested command, when the winning bash
     * unit came from a substitution or subshell. Absent for current-shell
     * (top-level) commands.
     */
    commandContext?: BashCommandContext;
}

/**
 * The child's session-approval suggestion, relayed to the serving node so a
 * human who grants "the whole session" records the same pattern the child
 * would have recorded locally.
 *
 * A plain data shape (not the `SessionApproval` value object) so it serializes
 * onto the forwarded request; the serving node rebuilds a `SessionApproval`
 * from it via `SessionApproval.multiple`.
 */
interface ForwardedSessionApproval {
    surface: string;
    patterns: readonly string[];
}
/**
 * The child-fixed facts a gate emits: the surface it evaluated and the match
 * set it computed. `requesterCwd` and `principal` are stamped at the escalation
 * edge (`ParentAuthorizer`), so a gate carries only what it alone can produce.
 *
 * Strings only — an `AccessPath` never crosses onto the wire
 * (`docs/decisions/0002-path-values-string-boundary.md`).
 */
interface ForwardedAccessFacts {
    /** Gate surface: `"path"`, `"external_directory"`, `"bash"`, a tool name, or a skill name. */
    surface: string;
    /**
     * The child-fixed match set. Path surface: `AccessPath.matchValues()`
     * (absolute ∪ cwd-relative ∪ canonical), computed at the child. Non-path
     * surface: the already-portable single value as a one-element array.
     */
    matchValues: string[];
    /** `AccessPath.boundaryValue()` (canonical) for a path surface; `null` for a non-path surface. */
    boundaryValue: string | null;
}

type PermissionReviewSource = "tool_call" | "skill_input" | "skill_read";
/**
 * Provenance of a forwarded ask: who is really asking, one hop below.
 *
 * Present on {@link PromptPermissionDetails} only when the ask was forwarded
 * from a subagent. Structurally identical to the event's `ForwardedPromptContext`
 * so the details flow straight into `buildUiPrompt`, but declared here to keep
 * the prompter layer free of an events-module import.
 */
interface ForwardedAskProvenance {
    requesterAgentName: string | null;
    requesterSessionId: string | null;
}
/** Details passed when prompting the user for a permission decision. */
interface PromptPermissionDetails {
    requestId: string;
    source: PermissionReviewSource;
    agentName: string | null;
    message: string;
    toolCallId?: string;
    toolName?: string;
    skillName?: string;
    path?: string;
    command?: string;
    target?: string;
    toolInputPreview?: string;
    /** Override label for the "for this session" dialog option. */
    sessionLabel?: string;
    /** Explicit display-surface override (a forwarded ask carries the child's original). */
    surface?: string | null;
    /** Explicit display-value override (a forwarded ask carries the child's original). */
    value?: string | null;
    /** Present iff this ask was forwarded from a subagent; drives the non-degraded broadcast + "(Subagent)" title. */
    forwarding?: ForwardedAskProvenance;
    /**
     * The session-approval suggestion for this ask. On the child's escalation it
     * rides into the forwarded request; on the serving node it lets the dialog
     * offer a whole-session grant scope. Absent when the gate computed no
     * suggestion.
     */
    sessionApproval?: ForwardedSessionApproval;
    /**
     * The child-fixed access facts the raising gate computed (surface + match
     * set). Rides through the runner to the escalation edge, which completes
     * them into a `ForwardedAccessIntent` by stamping `requesterCwd` and
     * `principal`. On a serving node these facts are projected back off the
     * forwarded request, so a forwarded ask reaches the `Authorizer` chain with
     * the same evidence as a local one; only a version-skew request that carried
     * no intent leaves this absent.
     */
    accessIntent?: ForwardedAccessFacts;
}

/**
 * A non-terminal chain link's ruling on an `ask`: decide (`allow`/`deny`) or
 * pass the ask on to the next link (`defer`). A `deny` carries an optional
 * teaching `reason` the invoking model sees, so it can self-correct.
 */
type AuthorizerVerdict = {
    kind: "allow";
} | {
    kind: "deny";
    reason?: string;
} | {
    kind: "defer";
};
/**
 * A non-terminal link in the live-authority chain: reviews an `ask` and may
 * decide it or defer to the next link (ADR 0007). The chain injects a narrow,
 * session-scoped {@link PermissionQuery} at `authorize` time (§3), so a link
 * queries the deterministic engine at gate parity rather than reaching for the
 * cross-extension service via `Symbol.for()`. It also injects an
 * {@link AuthorizerLog} so a link can record its decision trail to the shared
 * permission review log (same §3 injection pattern).
 */
interface Authorizer {
    authorize(details: PromptPermissionDetails, query: PermissionQuery, log: AuthorizerLog): Promise<AuthorizerVerdict>;
}

/**
 * Registry for custom tool access-intent extractors.
 *
 * Lets sibling extensions declare the filesystem path a tool will access when
 * the tool's input shape is not the default `input.path` convention, so the
 * cross-cutting `path` and `external_directory` gates can see it.
 * One extractor per tool name; duplicate registration throws.
 */
/** Returns the filesystem path this tool will access, or `undefined` to decline. */
type ToolAccessExtractor = (input: Record<string, unknown>) => string | undefined;

/**
 * Registry for custom tool-input preview formatters.
 *
 * Allows extensions to register a formatter for a specific tool name so
 * permission prompts can show a human-readable summary instead of raw JSON.
 * One formatter per tool name; duplicate registration throws.
 */
/** A custom preview formatter for one tool's input. Returns `undefined` to decline. */
type ToolInputFormatter = (input: Record<string, unknown>) => string | undefined;

/**
 * Cross-extension service accessor backed by `Symbol.for()` on `globalThis`.
 *
 * `Symbol.for()` is process-global by spec, so it survives jiti's per-extension
 * module isolation (`moduleCache: false`). A consumer doing
 * `import("@gotgenes/pi-permission-system")` gets a fresh module copy, but
 * `getPermissionsService()` reads from the same `globalThis` slot the provider
 * wrote to — enabling direct, synchronous, type-safe function calls.
 *
 * Best practice: call `getPermissionsService()` per use rather than caching the
 * reference — this ensures resilience across `/reload` and load-order edge cases.
 */

/**
 * The narrow review-log seam handed to a chain link at `authorize` time
 * (ADR 0007 §3, same injection pattern as {@link PermissionQuery}).
 *
 * A link uses it to record a positive decision trail to the permission review
 * log — `review` for the durable, default-on audit entry (one per handled
 * ask), `debug` for verbose or short-circuit detail gated behind the
 * `debugLog` toggle. The session's own logger is passed straight through, so a
 * link's entries land in the same `pi-permission-system-permission-review.jsonl`
 * as the gate decisions, keying to a gate entry by `requestId`.
 */
interface AuthorizerLog {
    review(event: string, details?: Record<string, unknown>): void;
    debug(event: string, details?: Record<string, unknown>): void;
}

/**
 * The narrow, read-only projection of {@link PermissionsService}: answer a
 * policy query for a surface, and report a tool-level state. This is the
 * capability an Authorizer chain link is handed (ISP) — it never sees the
 * registration surface.
 */
interface PermissionQuery {
    /**
     * Query the permission policy for a surface and value.
     *
     * @param surface   - Permission surface: "bash", "read", "mcp", "skill",
     *                    "external_directory", etc.
     * @param value     - The value to evaluate: command string, tool name, skill
     *                    name, or path. Omit or pass `undefined` for a
     *                    surface-level query.
     * @param agentName - Optional agent name for per-agent policy resolution.
     * @returns Full check result including state, matched pattern, and origin.
     */
    checkPermission(surface: string, value?: string, agentName?: string): PermissionCheckResult;
    /**
     * Query the tool-level permission state for pre-filtering tools before
     * creating a child session.
     *
     * Returns `"deny"` | `"allow"` | `"ask"` based on the composed policy.
     * Does not consider command-level rules (e.g. per-bash-command patterns) —
     * use `checkPermission` for runtime invocation gates.
     *
     * @param toolName  - Tool name (e.g. `"bash"`, `"read"`, `"my-extension:tool"`).
     * @param agentName - Optional agent name for per-agent policy resolution.
     */
    getToolPermission(toolName: string, agentName?: string): PermissionState;
}
/**
 * Public interface exposed to other extensions via `getPermissionsService()`.
 *
 * `checkPermission` takes a surface + optional value + optional agent name,
 * and delegates to `PermissionManager.checkPermission()` with current session
 * rules internally.
 */
interface PermissionsService extends PermissionQuery {
    /**
     * Register a custom preview formatter for a specific tool name.
     *
     * The formatter is consulted first inside `ToolPreviewFormatter.formatToolInputForPrompt`;
     * returning `undefined` falls through to the built-in switch (and ultimately
     * the JSON default).
     *
     * Only one formatter may be registered per tool name — a second call for the
     * same name throws.  The returned disposer unregisters the formatter.
     *
     * @param toolName  - Exact tool name to register for (e.g. `"mcp"`, `"my-server:run"`).
     * @param formatter - Receives the raw `input` record; return a string to use
     *                    as the prompt preview, or `undefined` to decline.
     */
    registerToolInputFormatter(toolName: string, formatter: ToolInputFormatter): () => void;
    /**
     * Register a custom access-intent extractor for a specific tool name.
     *
     * The extractor declares the filesystem path a tool will access so the
     * cross-cutting `path` and `external_directory` gates can see it. Use it for
     * tools whose path lives under a non-standard key — built-in file tools and
     * any tool exposing `input.path` (plus MCP via `input.arguments.path`) are
     * already covered by convention without registration.
     *
     * The extractor receives the raw `input` record and returns the path string,
     * or `undefined` to decline. Only one extractor may be registered per tool
     * name — a second call for the same name throws. The returned disposer
     * unregisters the extractor.
     *
     * @param toolName  - Exact tool name to register for (e.g. `"ffgrep"`).
     * @param extractor - Receives the raw `input` record; return the path string,
     *                    or `undefined` to decline.
     */
    registerToolAccessExtractor(toolName: string, extractor: ToolAccessExtractor): () => void;
    /**
     * Register a named live-authority chain link (ADR 0007 §4).
     *
     * A link reviews an `ask` and returns `allow` / `deny` (with an optional
     * teaching `reason`) / `defer`. It is handed a narrow, session-scoped
     * {@link PermissionQuery} at `authorize` time so it can query the
     * deterministic engine at gate parity. Register from a `permissions:ready`
     * handler so registration is robust to load order and survives `/reload`.
     *
     * Registration alone grants **no authority**: the link decides nothing until
     * the operator names it in the `authorizerChain` config (opt-in activation),
     * and the chain owner caps every verdict with the bounded-delegation
     * checkpoint (an `allow` on an excluded surface downgrades to `defer`). Only
     * one link may be registered per name — a second call for the same name
     * throws. The returned disposer unregisters the link.
     *
     * @param name      - Operator-facing link name referenced from `authorizerChain`.
     * @param authorize - The link's decision callback
     *                    (`(details, query, log) => verdict`); `log` is an
     *                    {@link AuthorizerLog} for recording a decision trail to
     *                    the shared permission review log.
     */
    registerAuthorizer(name: string, authorize: Authorizer["authorize"]): () => void;
}
/**
 * Store a `PermissionsService` on `globalThis` so other extensions can
 * retrieve it via `getPermissionsService()`.
 *
 * Called at `session_start` by the top-level (parent) instance only — an
 * in-process subagent child skips publishing so it cannot clobber the parent's
 * service. Overwrites any previously published service, which keeps `/reload`
 * working: a reloaded parent re-publishes its fresh service.
 */
declare function publishPermissionsService(service: PermissionsService): void;
/**
 * Retrieve the published `PermissionsService`, or `undefined` if the
 * permission-system extension has not loaded (or has been unloaded).
 */
declare function getPermissionsService(): PermissionsService | undefined;
/**
 * Remove `service` from `globalThis`, but only when the current slot still
 * holds it (identity compare-and-delete).
 *
 * Called during `session_shutdown` to avoid stale references after the
 * extension is torn down. Scoping the delete to the publishing instance keeps
 * two cases correct:
 *
 * - An in-process subagent child never published the parent's service, so its
 *   shutdown is a no-op and the parent's slot survives.
 * - A superseded `/reload` generation no longer owns the slot, so its late
 *   shutdown cannot wipe the new generation's freshly published service.
 */
declare function unpublishPermissionsService(service: PermissionsService): void;

export { PERMISSIONS_DECISION_CHANNEL, PERMISSIONS_READY_CHANNEL, PERMISSIONS_UI_PROMPT_CHANNEL, getPermissionsService, publishPermissionsService, unpublishPermissionsService };
export type { Authorizer, AuthorizerLog, AuthorizerVerdict, ForwardedPromptContext, PermissionCheckResult, PermissionDecisionEvent, PermissionQuery, PermissionState, PermissionUiPromptEvent, PermissionUiPromptSource, PermissionsReadyEvent, PermissionsService, PromptPermissionDetails, ToolInputFormatter };
