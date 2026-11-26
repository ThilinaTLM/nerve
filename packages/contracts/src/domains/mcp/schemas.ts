import { trustStateSchema } from "../core/trust-state.js";
import { z } from "zod";

/** Letters, digits, `_` and `-`: the names MCP clients accept, which tool names are built from. */
export const mcpServerNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(64);
/** The name of a secret an entry references as `${secret:<name>}`. */
export const mcpSecretNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(64);

/** Where a server is defined: the user's `mcp.json` or a project's. */
export const mcpScopeSchema = z.enum(["user", "project"]);
export type McpScope = z.infer<typeof mcpScopeSchema>;

/** The scope an operation acts on. */
export const mcpTargetSchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("user") }),
  z.strictObject({ scope: z.literal("project"), projectId: z.string().min(1) }),
]);
export type McpTarget = z.infer<typeof mcpTargetSchema>;

/** One entry of `mcp.json` as written (variables and `${secret:…}` references not expanded). */
export const mcpServerEntrySchema = z.strictObject({
  type: z.enum(["stdio", "http"]).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  /** The entry's own default; the agent settings' `mcpServers` map decides above it. */
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  /** Per-request timeout in seconds. */
  timeout: z.number().optional(),
});
export type McpServerEntry = z.infer<typeof mcpServerEntrySchema>;

export const mcpTransportSchema = z.enum(["stdio", "http"]);

/** The user's decision about an entry, by its exact content. */
/** The user's decision about an entry, by its exact content. */
export const mcpReviewStatusSchema = trustStateSchema;
export type McpReviewStatus = z.infer<typeof mcpReviewStatusSchema>;

export const mcpServerStateSchema = z.enum([
  "connected",
  "idle",
  "failed",
  "disabled",
  "needs_review",
  "declined",
]);
export type McpServerStateName = z.infer<typeof mcpServerStateSchema>;

/**
 * What an entry can send out of the machine: one `${VAR}` or `${secret:name}` reference. `field`
 * says where the value goes; `key` names the environment variable or header it is set in.
 */
export const mcpReferenceSchema = z.strictObject({
  kind: z.enum(["env", "secret"]),
  name: z.string(),
  field: z.enum(["command", "args", "env", "cwd", "url", "headers"]),
  key: z.string().optional(),
});
export type McpReference = z.infer<typeof mcpReferenceSchema>;

/**
 * Stored as the `grants` of an `mcp_server` trust decision (docs/architecture/trust.md): what the
 * user saw when approving. Values of variables and secrets are never part of it.
 */
export const mcpGrantSnapshotSchema = z.strictObject({
  transport: mcpTransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  cwd: z.string().optional(),
  /** Every environment entry of a stdio server, values as written (a `${…}` reference stays a reference). */
  env: z
    .array(
      z.strictObject({
        name: z.string(),
        value: z.string(),
        /** The variable changes what runs or where (PATH, NODE_OPTIONS, LD_*, PYTHON*, …). */
        changesExecution: z.boolean(),
      }),
    )
    .optional(),
  /** Every header of an HTTP server, values as written. */
  headers: z
    .array(z.strictObject({ name: z.string(), value: z.string() }))
    .optional(),
  /** A stdio server starts with Nerve's whole environment plus `env`. */
  inheritsEnvironment: z.boolean().optional(),
  references: z.array(mcpReferenceSchema),
});
export type McpGrantSnapshot = z.infer<typeof mcpGrantSnapshotSchema>;

/** The review of one entry: the grants plus what to approve (`configuration.decide` on `digest`). */
export const mcpReviewSchema = z.strictObject({
  name: mcpServerNameSchema,
  scope: mcpScopeSchema,
  status: mcpReviewStatusSchema,
  /** `sha256:<hex>` of the entry as written plus its scope: the `contentDigest` to decide on. */
  digest: z.string(),
  grants: mcpGrantSnapshotSchema,
  /** What can leave the machine, in sentences: "Sends `TOKEN` to `https://…` in header `Authorization`". */
  sends: z.array(z.string()),
  /** Other things to weigh: environment entries as written, ones that change what runs, the inherited environment. */
  notes: z.array(z.string()).optional(),
});
export type McpReview = z.infer<typeof mcpReviewSchema>;

export const mcpSecretStatusSchema = z.strictObject({
  name: mcpSecretNameSchema,
  /** Whether a value is stored. Values are never returned. */
  set: z.boolean(),
});

export const mcpServerRowSchema = z.strictObject({
  name: mcpServerNameSchema,
  scope: mcpScopeSchema,
  /** A user entry listed on a project target: it applies there, and is edited in user settings. */
  inherited: z.boolean(),
  /** A project entry that replaces a user entry of the same name (approved) or would (pending). */
  replacesUser: z.boolean(),
  /** A user entry a project entry replaces here. */
  shadowed: z.boolean(),
  transport: mcpTransportSchema,
  description: z.string().optional(),
  /** The entry as written, for the edit form. */
  entry: mcpServerEntrySchema,
  state: mcpServerStateSchema,
  /** Why it failed, or where the user acts. */
  error: z.string().optional(),
  review: mcpReviewStatusSchema,
  /** Switched on for this target by the agent settings (and the entry's own `enabled`). */
  enabled: z.boolean(),
  server: z.strictObject({ name: z.string(), version: z.string() }).optional(),
  /** Tools in the index, once the server was connected. */
  toolCount: z.number().int().nonnegative().optional(),
  /** Secrets the entry references. */
  secrets: z.array(mcpSecretStatusSchema),
});
export type McpServerRow = z.infer<typeof mcpServerRowSchema>;

export const mcpFileStatusSchema = z.strictObject({
  path: z.string(),
  exists: z.boolean(),
  /** Why the file or an entry is invalid. A file that is not valid JSON blocks `mcp.servers.save`. */
  problems: z.array(z.string()),
});

export const mcpServersListResultSchema = z.strictObject({
  servers: z.array(mcpServerRowSchema),
  file: mcpFileStatusSchema,
});

export const mcpSaveRequestSchema = z.strictObject({
  target: mcpTargetSchema,
  name: mcpServerNameSchema,
  entry: mcpServerEntrySchema,
  /** The entry's previous name when renaming; the old entry, its approval and unused secrets are removed. */
  previousName: mcpServerNameSchema.optional(),
  /** Values for the secrets the entry references; stored in the credential vault. */
  secrets: z.record(mcpSecretNameSchema, z.string()).optional(),
  /** Overwrite a file that is invalid on disk with a valid one holding this entry. */
  replaceInvalid: z.boolean().optional(),
});

export const mcpSaveResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("saved"), server: mcpServerRowSchema }),
  /** The entry is not valid; nothing was written. */
  z.strictObject({
    status: z.literal("invalid"),
    problems: z.array(z.string()),
  }),
  /** The file on disk is invalid; nothing was written. Repeat with `replaceInvalid` to replace it. */
  z.strictObject({
    status: z.literal("file_invalid"),
    problems: z.array(z.string()),
  }),
]);

export const mcpNamedRequestSchema = z.strictObject({
  target: mcpTargetSchema,
  name: mcpServerNameSchema,
});

export const mcpRemoveResultSchema = z.strictObject({
  removed: z.boolean(),
});

export const mcpTestResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    server: z
      .strictObject({ name: z.string(), version: z.string() })
      .optional(),
    instructions: z.string().optional(),
    tools: z.array(
      z.strictObject({
        name: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        inputSchema: z.record(z.string(), z.unknown()),
      }),
    ),
    resources: z.array(
      z.strictObject({
        uri: z.string(),
        name: z.string(),
        description: z.string().optional(),
        mimeType: z.string().optional(),
      }),
    ),
  }),
  /** Could not connect; `error` includes the tail of the program's stderr. */
  z.strictObject({ status: z.literal("failed"), error: z.string() }),
  /** Not tested: the entry is not approved, disabled by settings, or missing. */
  z.strictObject({
    status: z.literal("refused"),
    state: mcpServerStateSchema.or(z.literal("not_found")),
    reason: z.string(),
  }),
]);

export const mcpDisconnectResultSchema = z.strictObject({
  disconnected: z.boolean(),
});

export const mcpReviewResultSchema = mcpReviewSchema.nullable();
