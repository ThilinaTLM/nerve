import { z } from "zod";
import { conversationScopeSchema, sourceSchema } from "../core/scope.js";
import type {
  AccountAuth,
  AccountField as ApiAccountField,
  AccountKindData,
  AccountOAuth2Provider,
  AccountSecretField,
  ExtensionPermissions,
  PlatformUse,
  SettingField as ApiSettingField,
  SettingsSchema as ApiSettingsSchema,
} from "@nervekit/extension-api";
import { loopbackRedirectPathSchema } from "../auth/loopback.js";

/** Where a settings entry can live. Profiles act at conversation scope. */
export const extensionScopeSchema = conversationScopeSchema;
export type ExtensionScope = z.infer<typeof extensionScopeSchema>;

export const extensionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(64);

/** A platform name: lowercase words joined by hyphens (`github`, `google-workspace`). */
const PLATFORM_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

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
  /** Id of a user account of this kind, or any of several (`accounts.json`). */
  /** Id of an account of one of the `kind`s, or of a `platform`, whichever extension defined its kind. */
  z
    .strictObject({
      ...fieldBase,
      type: z.literal("account"),
      kind: z
        .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
        .optional(),
      platform: z.string().regex(PLATFORM_NAME).optional(),
    })
    .refine(
      (field) => (field.kind === undefined) !== (field.platform === undefined),
      {
        message: "An account field names either `kind` or `platform`.",
      },
    ),
  z.strictObject({
    ...fieldBase,
    type: z.literal("model"),
    capability: z.literal("vision").optional(),
    reasoning: z.boolean().optional(),
  }),
  /** An image generation model of the host's image backends: `{ provider, modelId }`. */
  z.strictObject({ ...fieldBase, type: z.literal("imageModel") }),
  z.strictObject({ ...fieldBase, type: z.literal("agentProfile") }),
  z.strictObject({ ...fieldBase, type: z.literal("permissionRuleSet") }),
]) as unknown as z.ZodType<ApiSettingField>;
export type SettingField = z.infer<typeof settingFieldSchema>;

/** The account kinds an `account` field accepts, in declared order. */
export function accountFieldKinds(field: {
  kind?: string | readonly string[] | undefined;
}): readonly string[] {
  if (field.kind === undefined) return [];
  return typeof field.kind === "string" ? [field.kind] : field.kind;
}

/** What an extension says about using a platform's accounts (`PlatformUse`). */
export const platformUseSchema = z.strictObject({
  platform: z.string().regex(PLATFORM_NAME),
  scopes: z.array(z.string().min(1)).optional(),
  origins: z.array(z.string().min(1)).optional(),
}) satisfies z.ZodType<PlatformUse>;

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

const secretNameSchema = fieldKeySchema;

/** How `ctx.http` injects an account's credential. */
export const accountAuthSchema = z.discriminatedUnion("scheme", [
  z.strictObject({
    scheme: z.literal("basic"),
    /** Account field holding the user name. */
    user: fieldKeySchema,
    secret: secretNameSchema.optional(),
  }),
  z.strictObject({
    scheme: z.literal("bearer"),
    secret: secretNameSchema.optional(),
  }),
  z.strictObject({
    scheme: z.literal("header"),
    name: z.string().regex(/^[A-Za-z0-9-]+$/),
    secret: secretNameSchema.optional(),
  }),
  z.strictObject({
    scheme: z.literal("query"),
    name: z.string().min(1).max(128),
    secret: secretNameSchema.optional(),
  }),
]) satisfies z.ZodType<AccountAuth>;

export const accountSecretFieldSchema = z.strictObject({
  label: z.string().min(1),
  help: z.string().optional(),
  multiline: z.boolean().optional(),
}) satisfies z.ZodType<AccountSecretField>;

/** The name of the single secret declared with the `secret` shorthand. */
export const DEFAULT_ACCOUNT_SECRET = "secret";

/** The typed-in secrets of a kind by name; the `secret` shorthand is the one named `secret`. */
export function accountSecretFields(kind: {
  secret?: AccountSecretField | undefined;
  secrets?: Readonly<Record<string, AccountSecretField>> | undefined;
}): Record<string, AccountSecretField> {
  if (kind.secrets) return { ...kind.secrets };
  return kind.secret ? { [DEFAULT_ACCOUNT_SECRET]: kind.secret } : {};
}

/** The injections of a kind, in declared order, each with the secret it uses resolved. */
export function accountInjections(kind: {
  secret?: AccountSecretField | undefined;
  secrets?: Readonly<Record<string, AccountSecretField>> | undefined;
  auth?: AccountAuth | readonly AccountAuth[] | undefined;
}): (AccountAuth & { secret: string })[] {
  if (!kind.auth) return [];
  const names = Object.keys(accountSecretFields(kind));
  return (Array.isArray(kind.auth) ? kind.auth : [kind.auth]).map(
    (auth: AccountAuth) => ({ ...auth, secret: auth.secret ?? names[0] ?? "" }),
  );
}

const endpointSchema = z.string().min(1).max(2048);

/** The `oauth2` provider of an account kind; see `AccountOAuth2Provider`. */
export const accountOAuth2ProviderSchema = z.strictObject({
  type: z.literal("oauth2"),
  flows: z
    .array(z.enum(["authorization_code", "device_code"]))
    .min(1)
    .optional(),
  discovery: endpointSchema.optional(),
  authorizationUrl: endpointSchema.optional(),
  tokenUrl: endpointSchema.optional(),
  deviceAuthorizationUrl: endpointSchema.optional(),
  revocationUrl: endpointSchema.optional(),
  scopes: z.array(z.string().min(1)).optional(),
  clientIdField: fieldKeySchema.optional(),
  clientSecret: secretNameSchema.optional(),
  authorizationParams: z.record(z.string(), z.string()).optional(),
  redirectPath: loopbackRedirectPathSchema.optional(),
  userinfo: z
    .strictObject({
      url: endpointSchema,
      identity: z.record(fieldKeySchema, z.string().min(1)),
    })
    .optional(),
}) satisfies z.ZodType<AccountOAuth2Provider>;

/**
 * The injections an account's credential goes out with: its `auth`, or a bearer token for `oauth2`.
 * An extension provider decides itself what it adds; the bearer entry only marks the kind as
 * credentialed and names `authorization` among the headers a caller's own value must not reach.
 */
export function accountEffectiveAuth(kind: {
  auth?: AccountAuth | readonly AccountAuth[] | undefined;
  provider?: { type: "oauth2" } | "extension" | undefined;
}): AccountAuth | readonly AccountAuth[] | undefined {
  return kind.auth ?? (kind.provider ? { scheme: "bearer" } : undefined);
}

/** Key of the account field that holds an `oauth2` kind's client id. */
export const accountClientIdField = (provider: {
  clientIdField?: string | undefined;
}): string => provider.clientIdField ?? "clientId";

/** The field types an account kind's `fields` may use (`AccountField`). */
const ACCOUNT_FIELD_TYPES: ReadonlySet<string> = new Set([
  "boolean",
  "string",
  "number",
  "enum",
]);

const accountKindObjectSchema = z.strictObject({
  kind: z.string().min(1),
  label: z.string().min(1),
  /** The platform the account is for; shared between definitions. */
  platform: z.string().regex(PLATFORM_NAME).optional(),
  /** Non-secret fields stored with the account. */
  // Parsed as any setting field so a wrong type gets a message that names the allowed ones.
  fields: z
    .record(fieldKeySchema, settingFieldSchema)
    .superRefine((fields, context) => {
      for (const [key, field] of Object.entries(fields))
        if (!ACCOUNT_FIELD_TYPES.has(field.type))
          context.addIssue({
            code: "custom",
            path: [key, "type"],
            message: `Account kinds cannot have ${field.type} fields: the account dialog cannot show them. Use string, number, boolean or enum.`,
          });
    }) as unknown as z.ZodType<Record<string, ApiAccountField>>,
  secret: accountSecretFieldSchema.optional(),
  secrets: z.record(secretNameSchema, accountSecretFieldSchema).optional(),
  /** How the host sends the secrets with `ctx.http` requests. Absent: the kind has no injected credential. */
  auth: z
    .union([accountAuthSchema, z.array(accountAuthSchema).min(1)])
    .optional(),
  /** How the host obtains the credential. Absent: the user types in the secrets. */
  provider: z
    .union([accountOAuth2ProviderSchema, z.literal("extension")])
    .optional(),
  /** Origins an extension provider's `ctx.http` may reach. */
  signInOrigins: z.array(z.string().min(1)).optional(),
  /** Origins the credential is sent to; `{<field>}` is replaced by the account's field. */
  origins: z.array(z.string().min(1)).optional(),
  test: z.literal(true).optional(),
});

/** An `oauth2` kind sends its access token itself, and its endpoints and client are declared. */
function checkOAuth2(
  kind: Pick<z.infer<typeof accountKindObjectSchema>, "auth" | "fields">,
  provider: z.infer<typeof accountOAuth2ProviderSchema>,
  secretNames: string[],
  context: z.RefinementCtx,
): void {
  const problem = (path: string, message: string) =>
    context.addIssue({ code: "custom", path: ["provider", path], message });
  if (kind.auth !== undefined)
    context.addIssue({
      code: "custom",
      path: ["auth"],
      message:
        "A kind with an `oauth2` provider sends its access token as a bearer token; remove `auth`.",
    });
  const flows = provider.flows ?? ["authorization_code"];
  if (!provider.tokenUrl && !provider.discovery)
    problem("tokenUrl", "Give `tokenUrl` or `discovery`.");
  if (
    flows.includes("authorization_code") &&
    !provider.authorizationUrl &&
    !provider.discovery
  )
    problem("authorizationUrl", "Give `authorizationUrl` or `discovery`.");
  if (
    flows.includes("device_code") &&
    !provider.deviceAuthorizationUrl &&
    !provider.discovery
  )
    problem(
      "deviceAuthorizationUrl",
      "Give `deviceAuthorizationUrl` or `discovery`.",
    );
  const clientId = accountClientIdField(provider);
  if (kind.fields[clientId]?.type !== "string")
    problem(
      "clientIdField",
      `The client id needs a string field '${clientId}' (give it a default to ship a client id).`,
    );
  if (provider.clientSecret && !secretNames.includes(provider.clientSecret))
    problem(
      "clientSecret",
      `'${provider.clientSecret}' is not one of the kind's secrets.`,
    );
  for (const name of secretNames)
    if (name !== provider.clientSecret)
      problem(
        "clientSecret",
        `The secret '${name}' is not used: an oauth2 kind has only its client secret.`,
      );
}

/** An extension provider signs the requests itself: it needs the origins its output may go to. */
function checkExtensionProvider(
  kind: Pick<
    z.infer<typeof accountKindObjectSchema>,
    "auth" | "origins" | "signInOrigins"
  >,
  context: z.RefinementCtx,
): void {
  if (kind.auth !== undefined)
    context.addIssue({
      code: "custom",
      path: ["auth"],
      message:
        'A kind with `provider: "extension"` signs requests in its credential provider; remove `auth`.',
    });
  if (!kind.origins?.length)
    context.addIssue({
      code: "custom",
      path: ["origins"],
      message:
        'A kind with `provider: "extension"` needs `origins`: the credential is sent only there.',
    });
}

/** Secrets are declared once, and every injection names one of them. */
const checkAccountSecrets = (
  kind:
    | z.infer<typeof accountKindObjectSchema>
    | Omit<z.infer<typeof accountKindObjectSchema>, "kind">,
  context: z.RefinementCtx,
): void => {
  if (kind.secret && kind.secrets)
    context.addIssue({
      code: "custom",
      path: ["secrets"],
      message: "Declare either `secret` or `secrets`, not both.",
    });
  const names = Object.keys(accountSecretFields(kind));
  const provider = kind.provider;
  if (provider === "extension") checkExtensionProvider(kind, context);
  else if (provider) checkOAuth2(kind, provider, names, context);
  else if (names.length === 0)
    context.addIssue({
      code: "custom",
      path: ["secret"],
      message:
        "An account kind needs a `secret` or at least one `secrets` entry.",
    });
  for (const [index, auth] of (kind.auth === undefined
    ? []
    : Array.isArray(kind.auth)
      ? kind.auth
      : [kind.auth]
  ).entries()) {
    if (auth.secret === undefined && names.length > 1)
      context.addIssue({
        code: "custom",
        path: ["auth", index, "secret"],
        message: `Name the secret this injection uses (${names.join(", ")}).`,
      });
    else if (auth.secret !== undefined && !names.includes(auth.secret))
      context.addIssue({
        code: "custom",
        path: ["auth", index, "secret"],
        message: `'${auth.secret}' is not one of the kind's secrets (${names.join(", ")}).`,
      });
  }
};

/** An account kind an extension defines; holds credentials, at user or project level. */
export const accountKindSchema = accountKindObjectSchema.superRefine(
  checkAccountSecrets,
) satisfies z.ZodType<AccountKindData & { kind: string; test?: true }>;
/** The kind as written in an installed manifest, keyed by its name. */
export const accountKindDataSchema = accountKindObjectSchema
  .omit({ kind: true })
  .superRefine(checkAccountSecrets);
export type AccountKind = z.infer<typeof accountKindSchema>;

/** What an extension may reach: network origins, model services and frame services. */
export const extensionPermissionsSchema = z.strictObject({
  network: z.array(z.string().min(1)).optional(),
  models: z.array(z.enum(["image", "vision", "text"])).optional(),
  frame: z.array(z.enum(["chat.startConversation"])).optional(),
}) satisfies z.ZodType<ExtensionPermissions>;
export type ExtensionPermissionsData = z.infer<
  typeof extensionPermissionsSchema
>;

/** Lucide icons an extension may name; the app maps each, so an addition fails its type check until mapped. */
export const extensionLucideIconSchema = z.enum([
  "blocks",
  "eye",
  "globe",
  "image-plus",
  "layers",
  "workflow",
]);
export type ExtensionLucideIcon = z.infer<typeof extensionLucideIconSchema>;

/**
 * An extension's mark: a lucide icon, or the extension's own SVG as a
 * `data:image/svg+xml` URI the host built and checked. The app renders SVGs
 * as `<img>`, never inline.
 */
export const extensionIconSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("lucide"),
    name: extensionLucideIconSchema,
  }),
  z.strictObject({
    type: z.literal("svg"),
    src: z.string().startsWith("data:image/svg+xml,"),
  }),
]);
export type ExtensionIcon = z.infer<typeof extensionIconSchema>;

/** Serializable extension description for the app. */
export const extensionMetadataSchema = z.strictObject({
  id: extensionIdSchema,
  name: z.string().min(1),
  description: z.string(),
  icon: extensionIconSchema,
  /** Where the extension comes from; the Extensions page groups by it. */
  source: sourceSchema,
  settingsVersion: z.number().int().positive(),
  /** Default of the implicit `enabled` switch. */
  enabledByDefault: z.boolean(),
  /** What the extension may reach (network origins, model and frame services); shown for consent. */
  permissions: extensionPermissionsSchema,
  /** What the extension adds, for the detail view. */
  contributes: z.strictObject({
    /** `quick_script` namespaces. */
    namespaces: z.array(
      z.strictObject({
        id: z.string().min(1),
        /** Title on the Extensions page; the id when absent. */
        label: z.string().min(1).optional(),
        /** Boolean setting that switches the namespace; absent when it follows the extension. */
        enabledBy: z.union([z.string(), z.array(z.string())]).optional(),
        /** Account setting that must select an account with a saved secret. */
        requiresAccount: z.string().optional(),
        /** Supporting namespace, not listed to the user. */
        helper: z.boolean().optional(),
        summary: z.string(),
      }),
    ),
    /** Direct tools: name, Tools-page label (the name when the tool has none) and description. */
    tools: z.array(
      z.strictObject({
        name: z.string().min(1),
        label: z.string().min(1),
        description: z.string(),
      }),
    ),
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
