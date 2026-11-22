/* Risk and permission checks of extension calls. */

// ── Risk, authorization ──────────────────────────────────────────────────────

/**
 * What a method can do at most: `none` has no external effect, `read` reads
 * local data, `external_read` reads through an integration, `write` changes
 * workspace files, `external_write` changes things in an integration,
 * `destructive` deletes or cannot be analysed.
 */
export type Risk =
  | "none"
  | "read"
  | "external_read"
  | "write"
  | "external_write"
  | "destructive";

/** A resource a call acts on, normalized `<system>:<type>/<id>`: `jira:issue/APP-12`. In `OperationAuthorization.targets` a bare string is the same as `{ kind: "resource", value }`. */
export type OperationTarget = {
  /** Always `"resource"`. */
  kind: "resource";
  /** `<system>:<type>/<id>`; permission rules match against it. Lower-case system and type, the id as the service spells it. */
  value: string;
};

/** An operation on targets, as the permission policy checks it; what `ExtensionContext.authorize` takes. */
export type OperationCheck = {
  /** Operation name rules match on. Defaults to `<namespace>.<method>`; for an own direct tool `<extension id>.<tool name>`. */
  operation?: string;
  /** Resources the call acts on; empty when it acts on none (the policy then checks the operation alone). */
  targets: readonly (OperationTarget | string)[];
  /** Defaults to the method's declared `risk`. It is never above the declared `risk`; in `authorize`, lower it only with `riskFromArgs: true`. */
  risk?: Risk;
};

/** What the permission policy checks for a call: an operation on targets. Use it for everything the arguments already name; use `ExtensionContext.authorize` for targets known only after a lookup. */
export type OperationAuthorization = OperationCheck & {
  /** Short label for approval prompts and records (the JQL, the issue key, the path). */
  summary: string;
};

/**
 * A call checked as a host tool, e.g. `{ toolName: "read", args: { path } }`
 * for a workspace file the method will read through `ctx.artifacts.read`.
 */
export type ToolAuthorization = {
  /** Name of a host tool, such as `read`; that tool's permission rules and approvals apply. */
  toolName: string;
  /** Arguments as that tool takes them (`{ path }` for `read`). */
  args: Record<string, unknown>;
  /** Short label for approval prompts and records. */
  summary: string;
};

/** One permission check a call is authorized as: an operation on targets, or a host tool call. */
export type Authorization = OperationAuthorization | ToolAuthorization;

/** What `authorize` returns: one check, several (every one must pass) or none. */
export type AuthorizeResult =
  | Authorization
  | readonly Authorization[]
  | undefined;
