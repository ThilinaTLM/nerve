import { z } from "zod";
import type {
  AccountAuth,
  AccountKindData,
  ExtensionPermissions,
  SettingField as ApiSettingField,
  SettingsSchema as ApiSettingsSchema,
} from "@nervekit/extension-api";

/** Where a settings entry can live. Profiles act at conversation scope. */
export const extensionScopeSchema = z.enum(["user", "project", "conversation"]);
export type ExtensionScope = z.infer<typeof extensionScopeSchema>;

export const extensionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(64);

const fieldKeySchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*$/)
  .max(64);

const fieldBase = {
  label: z.string().min(1),
  description: z.string().optional(),
  section: z.string().optional(),
  scopes: z.array(extensionScopeSchema).min(1).optional(),
  visibleWhen: z
    .strictObject({
      field: fieldKeySchema,
      equals: z.union([z.string(), z.boolean()]),
    })
    .optional(),
  advanced: z.boolean().optional(),
};

/**
 * One setting of an extension. The set of types is deliberately small; a type
 * is added only when a built-in extension needs it. Secrets are never settings.
 */
export const settingFieldSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...fieldBase,
    type: z.literal("boolean"),
    default: z.boolean(),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("string"),
    default: z.string().optional(),
    format: z.enum(["url", "text"]).optional(),
    placeholder: z.string().optional(),
    maxLength: z.number().int().positive().optional(),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("number"),
    default: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    unit: z.string().optional(),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("enum"),
    default: z.string(),
    options: z
      .array(
        z.strictObject({
          value: z.string(),
          label: z.string(),
          description: z.string().optional(),
        }),
      )
      .min(1),
  }),
  /** Id of a user account of this kind (`accounts.json`). */
  z.strictObject({
    ...fieldBase,
    type: z.literal("account"),
    kind: z.string().min(1),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("model"),
    capability: z.enum(["image", "vision"]).optional(),
  }),
]) satisfies z.ZodType<ApiSettingField>;
export type SettingField = z.infer<typeof settingFieldSchema>;

export const settingsSchemaSchema = z.strictObject({
  sections: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .optional(),
  fields: z.record(fieldKeySchema, settingFieldSchema),
}) satisfies z.ZodType<ApiSettingsSchema>;
export type SettingsSchema = z.infer<typeof settingsSchemaSchema>;

/** How `ctx.http` injects an account's credential. */
export const accountAuthSchema = z.discriminatedUnion("scheme", [
  z.strictObject({
    scheme: z.literal("basic"),
    /** Account field holding the user name. */
    user: fieldKeySchema,
  }),
  z.strictObject({ scheme: z.literal("bearer") }),
  z.strictObject({
    scheme: z.literal("header"),
    name: z.string().regex(/^[A-Za-z0-9-]+$/),
  }),
]) satisfies z.ZodType<AccountAuth>;

/** An account kind an extension defines; accounts are user-only and hold credentials. */
export const accountKindSchema = z.strictObject({
  kind: z.string().min(1),
  label: z.string().min(1),
  /** Non-secret fields stored in `accounts.json`. */
  fields: z.record(fieldKeySchema, settingFieldSchema),
  secret: z.strictObject({
    label: z.string().min(1),
    help: z.string().optional(),
  }),
  /** How the host sends the secret with `ctx.http` requests. Absent: the kind has no injected credential. */
  auth: accountAuthSchema.optional(),
  /** Origins the credential is sent to; `{<field>}` is replaced by the account's field. */
  origins: z.array(z.string().min(1)).optional(),
  test: z.literal(true).optional(),
}) satisfies z.ZodType<AccountKindData & { kind: string; test?: true }>;
export type AccountKind = z.infer<typeof accountKindSchema>;

/** What an extension may reach: network origins and host capabilities. */
export const extensionPermissionsSchema = z.strictObject({
  network: z.array(z.string().min(1)).optional(),
  capabilities: z.array(z.enum(["models.image"])).optional(),
}) satisfies z.ZodType<ExtensionPermissions>;
export type ExtensionPermissionsData = z.infer<
  typeof extensionPermissionsSchema
>;

/** Serializable extension description for the app. */
export const extensionMetadataSchema = z.strictObject({
  id: extensionIdSchema,
  name: z.string().min(1),
  description: z.string(),
  icon: z.string().min(1),
  source: z.enum(["builtin"]),
  settingsVersion: z.number().int().positive(),
  /** Default of the implicit `enabled` switch. */
  enabledByDefault: z.boolean(),
  /** What the extension may reach (network origins, host capabilities); shown for consent. */
  permissions: extensionPermissionsSchema,
  /** What the extension adds, for the detail view. */
  contributes: z.strictObject({
    /** `quick_script` namespaces. */
    namespaces: z.array(
      z.strictObject({
        id: z.string().min(1),
        /** Boolean setting that switches the namespace; absent when it follows the extension. */
        enabledBy: z.union([z.string(), z.array(z.string())]).optional(),
        /** Account setting that must select an account with a saved secret. */
        requiresAccount: z.string().optional(),
        /** Supporting namespace, not listed to the user. */
        helper: z.boolean().optional(),
        summary: z.string(),
      }),
    ),
    /** Direct tool names. */
    tools: z.array(z.string()),
    /** Skill names. */
    skills: z.array(z.string()),
  }),
});
export type ExtensionMetadata = z.infer<typeof extensionMetadataSchema>;

/** What the settings machinery needs to know about one extension. */
export type ExtensionSettingsDefinition = {
  id: string;
  settingsVersion: number;
  /** Default of the implicit `enabled` switch. */
  enabledByDefault: boolean;
  settings: SettingsSchema;
  /** `migrations[n]` converts version n-1 settings to version n. */
  migrations?: Readonly<
    Record<
      number,
      (settings: Record<string, unknown>) => Record<string, unknown>
    >
  >;
};

/** Field scopes, all three unless the field narrows them. */
export function fieldScopes(field: SettingField): readonly ExtensionScope[] {
  return field.scopes ?? ["user", "project", "conversation"];
}
