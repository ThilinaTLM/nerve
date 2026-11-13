import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import {
  accountKindSchema,
  extensionMetadataSchema,
  extensionIdSchema,
  settingsSchemaSchema,
} from "./settings-schema.js";

export const extensionTargetSchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("user") }),
  z.strictObject({ scope: z.literal("project"), projectId: z.string().min(1) }),
  z.strictObject({
    scope: z.literal("conversation"),
    conversationId: z.string().min(1),
  }),
]);
export type ExtensionTarget = z.infer<typeof extensionTargetSchema>;

const sourceSchema = z.strictObject({
  layer: z.enum(["default", "user", "project", "profile", "conversation"]),
  /** Profile that contributes the value. */
  profile: z.string().optional(),
  /** A profile requirement: not editable below it. */
  locked: z.boolean().optional(),
});

const resolvedFieldSchema = z.strictObject({
  value: z.unknown(),
  source: sourceSchema,
  /** False when `visibleWhen` hides the field; the stored value is kept. */
  visible: z.boolean(),
});

const namespaceAvailabilitySchema = z.union([
  z.strictObject({ configured: z.boolean(), available: z.literal(true) }),
  z.strictObject({
    configured: z.boolean(),
    available: z.literal(false),
    reason: z.string(),
    /** What the user must do; names the page. */
    fix: z.string(),
  }),
]);

const storedEntrySchema = z.strictObject({
  enabled: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()),
});

export const extensionViewSchema = z.strictObject({
  metadata: extensionMetadataSchema,
  settingsSchema: settingsSchemaSchema,
  accountKinds: z.array(accountKindSchema),
  enabled: z.strictObject({ value: z.boolean(), source: sourceSchema }),
  fields: z.record(z.string(), resolvedFieldSchema),
  /** This scope's own entry after upgrade, or null; drives "set here" markers and per-field reset. */
  stored: storedEntrySchema.nullable(),
  /** The entry at this scope was written by newer code and cannot be edited. */
  readOnly: z.boolean(),
  /** Fields (and `enabled`) an applied profile requires; conversation scope only. */
  locked: z.array(z.string()),
  /** Per `quick_script` namespace the extension contributes. */
  availability: z.record(z.string(), namespaceAvailabilitySchema),
});
export type ExtensionView = z.infer<typeof extensionViewSchema>;

const diagnosticSchema = z.strictObject({
  code: z.enum([
    "unknown-extension",
    "newer-version",
    "upgrade-failed",
    "invalid-value",
    "unknown-field",
    "scope-not-allowed",
    "file-unavailable",
    "untrusted-project",
  ]),
  extensionId: z.string().optional(),
  layer: z.enum(["user", "project", "profile", "conversation"]),
  field: z.string().optional(),
  message: z.string(),
});

export const extensionsViewSchema = z.strictObject({
  target: extensionTargetSchema,
  /** Registered extensions in display order, resolved as seen at the target. */
  extensions: z.array(extensionViewSchema),
  /** The target's own file, for expected-revision saves and trust. */
  file: z.strictObject({
    status: z.enum(["ready", "missing", "unavailable"]),
    path: z.string(),
    revision: z.number().int().nonnegative(),
    digest: z.string(),
    /** Project files only; untrusted files are ignored by resolution. */
    trusted: z.boolean().nullable(),
  }),
  diagnostics: z.array(diagnosticSchema),
  /** Entries of extensions that are not registered; kept in the file. */
  unknown: z.array(
    z.strictObject({
      id: z.string(),
      layer: z.enum(["user", "project", "profile", "conversation"]),
    }),
  ),
});
export type ExtensionsView = z.infer<typeof extensionsViewSchema>;

const expectedSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  digest: z.string().min(1),
});
const entrySchema = z.strictObject({
  enabled: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const saveExtensionRequestSchema = z.strictObject({
  target: extensionTargetSchema,
  expected: expectedSchema,
  id: extensionIdSchema,
  /** Replaces the stored entry at the target; omitted keys are removed. */
  entry: entrySchema,
});
export const resetExtensionRequestSchema = z.strictObject({
  target: extensionTargetSchema,
  expected: expectedSchema,
  id: extensionIdSchema,
  /** Settings keys, or `enabled`, to remove; omitted removes the whole entry. */
  fields: z.array(z.string()).optional(),
});
export const extensionMutationResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("saved"), view: extensionsViewSchema }),
  /** The file changed since `expected`; read again. */
  z.strictObject({ status: z.literal("conflict") }),
  /** The file is invalid or incompatible; fix or reset it first. */
  z.strictObject({ status: z.literal("unavailable") }),
  z.strictObject({ status: z.literal("read-only"), message: z.string() }),
  z.strictObject({
    status: z.literal("invalid"),
    issues: z.array(
      z.strictObject({
        code: z.enum(["unknown-field", "invalid-value"]),
        field: z.string(),
        message: z.string(),
      }),
    ),
  }),
]);
export type ExtensionMutationResult = z.infer<
  typeof extensionMutationResultSchema
>;

export const trustProjectExtensionsRequestSchema = z.strictObject({
  projectId: z.string().min(1),
  /** Digest of the file the user reviewed (`file.digest`). */
  expectedDigest: z.string().min(1),
  trusted: z.boolean(),
});
export const trustProjectExtensionsResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("saved"),
      trusted: z.boolean(),
      view: extensionsViewSchema,
    }),
    z.strictObject({ status: z.literal("conflict") }),
  ],
);

const host = ["workbench_server"] as const;
export const extensionOperationDefinitions = [
  defineOperation(
    "extensions.get",
    z.strictObject({ target: extensionTargetSchema }),
    extensionsViewSchema,
    "read",
    "none",
    host,
    "operation.extensions.get",
  ),
  defineOperation(
    "extensions.save",
    saveExtensionRequestSchema,
    extensionMutationResultSchema,
    "mutation",
    "none",
    host,
    "operation.extensions.save",
  ),
  defineOperation(
    "extensions.reset",
    resetExtensionRequestSchema,
    extensionMutationResultSchema,
    "mutation",
    "none",
    host,
    "operation.extensions.reset",
  ),
  defineOperation(
    "extensions.trustProject",
    trustProjectExtensionsRequestSchema,
    trustProjectExtensionsResultSchema,
    "mutation",
    "none",
    host,
    "operation.extensions.trustProject",
  ),
] as const;
