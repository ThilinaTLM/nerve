import { z } from "zod";

/** Where an extension comes from. Precedence: project, then user, then built-in. */
export const extensionSourceSchema = z.enum(["builtin", "user", "project"]);
export type ExtensionSource = z.infer<typeof extensionSourceSchema>;

/**
 * What the host did with a discovered extension: `enabled` (loaded), `pending_consent` (valid, not
 * trusted, so its code is not opened), `disabled` (turned off by the user), `incompatible`
 * (outside the supported SDK range), `invalid` (failed validation or collides with another
 * extension) or `shadowed` (a higher-precedence root has the same id).
 */
export const extensionStateSchema = z.enum([
  "enabled",
  "pending_consent",
  "disabled",
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
});
export type ExtensionCatalogEntry = z.infer<typeof extensionCatalogEntrySchema>;
