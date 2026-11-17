import { z } from "zod";

/** Where an extension comes from. Precedence: project, then user, then built-in. */
export const extensionSourceSchema = z.enum(["builtin", "user", "project"]);
export type ExtensionSource = z.infer<typeof extensionSourceSchema>;

/**
 * What the host did with a discovered extension: `enabled` (loaded), `pending_consent` (valid, not
 * trusted, so its code is not opened), `incompatible`
 * (outside the supported SDK range), `invalid` (failed validation or collides with another
 * extension) or `shadowed` (a higher-precedence root has the same id).
 */
export const extensionStateSchema = z.enum([
  "enabled",
  "pending_consent",
  "incompatible",
  "invalid",
  "shadowed",
]);
export type ExtensionState = z.infer<typeof extensionStateSchema>;

export const extensionCatalogDiagnosticSchema = z.strictObject({
  level: z.enum(["error", "warning"]),
  message: z.string(),
});
export type ExtensionCatalogDiagnostic = z.infer<
  typeof extensionCatalogDiagnosticSchema
>;

/** One line of what an extension asks consent for, in plain language. */
export const extensionConsentItemSchema = z.strictObject({
  kind: z.enum([
    "network",
    "account",
    "capability",
    "tools",
    "namespace",
    "ui",
    "code",
  ]),
  text: z.string(),
  /** A grant much wider than usual (every host); the review calls it out. */
  broad: z.boolean().optional(),
});
export type ExtensionConsentItem = z.infer<typeof extensionConsentItemSchema>;

/**
 * What the user is asked to allow for a pending extension. For an update (`update`), only what is
 * new since the last consent. `contentHash` names the exact files that were summarized; a consent
 * is accepted only for that hash.
 */
export const extensionConsentSchema = z.strictObject({
  update: z.boolean(),
  contentHash: z.string().min(1),
  items: z.array(extensionConsentItemSchema),
  /** The same summary as plain text, one line per item. */
  text: z.string(),
});
export type ExtensionConsent = z.infer<typeof extensionConsentSchema>;

/** One extension the host knows of, loaded or not. */
export const extensionCatalogEntrySchema = z.strictObject({
  /** The extension id; the folder name when the manifest could not be read. */
  id: z.string().min(1),
  source: extensionSourceSchema,
  state: extensionStateSchema,
  /** Folder of an installed extension; absent for built-ins. */
  path: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  sdkVersion: z.string().optional(),
  /** `shadowed` only: the source that has the id. */
  shadowedBy: extensionSourceSchema.optional(),
  diagnostics: z.array(extensionCatalogDiagnosticSchema),
  /** `pending_consent` only: what to review before allowing. */
  consent: extensionConsentSchema.optional(),
});
export type ExtensionCatalogEntry = z.infer<typeof extensionCatalogEntrySchema>;
