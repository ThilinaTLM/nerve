import { z } from "zod";
import { extensionIdSchema } from "./settings-schema.js";

export const extensionEntrySchema = z.strictObject({
  version: z.number().int().positive().meta({
    description: "Settings version the extension declares for these settings.",
  }),
  enabled: z
    .boolean()
    .meta({ description: "Turn the extension on or off." })
    .optional(),
  settings: z
    .record(z.string(), z.unknown())
    .meta({
      description:
        "Extension settings by field key, as the extension documents them.",
    })
    .optional(),
});
export type ExtensionEntry = z.infer<typeof extensionEntrySchema>;
export type ExtensionEntries = Record<string, ExtensionEntry>;

/** `config/extensions.json` at user, project and conversation scope. */
export const extensionsDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  extensions: z.record(extensionIdSchema, extensionEntrySchema),
});
export type ExtensionsDocument = z.infer<typeof extensionsDocumentSchema>;

export const emptyExtensionsDocument = (): ExtensionsDocument => ({
  schemaVersion: 1,
  revision: 0,
  extensions: {},
});

/** Profile contribution: the same entry shape; requirements lock their fields. */
export const profileExtensionsSchema = z.strictObject({
  recommendations: z
    .record(extensionIdSchema, extensionEntrySchema)
    .meta({
      description:
        "Extension entries used unless the conversation chooses otherwise.",
    })
    .optional(),
  requirements: z
    .record(extensionIdSchema, extensionEntrySchema)
    .meta({
      description: "Extension entries locked while the profile is applied.",
    })
    .optional(),
});
export type ProfileExtensions = z.infer<typeof profileExtensionsSchema>;
