import { z } from "zod";
import type { ExtensionDefinitionData } from "@nervekit/extension-api";
import {
  accountKindSchema,
  extensionIdSchema,
  extensionPermissionsSchema,
  settingsSchemaSchema,
} from "./settings-schema.js";
import { extensionToolViewSchema } from "./tool-display.js";

/*
 * `dist/manifest.json` of an installed extension: the plain-data part of its definition
 * (`extensionDefinitionData`; hooks are `true`) plus `version` and `sdkVersion`. Every object is
 * strict, so an unknown or misspelled field is an error with a path, not a silent no-op.
 */

const semver = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    "must be a version such as 0.41.1",
  );

const risk = z.enum([
  "none",
  "read",
  "external_read",
  "write",
  "external_write",
  "destructive",
]);

const hook = z.literal(true);

/** `<namespace>` ids are global names in the script sandbox. */
export const installedNamespaceIdSchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]{0,31}$/);

const requiresSchema = z.strictObject({
  account: z.string().min(1).optional(),
});

const methodSchema = z.strictObject({
  risk,
  riskFromArgs: z.boolean().optional(),
  signature: z.string().min(1),
  parse: hook,
  authorize: hook.optional(),
  resource: hook.optional(),
  run: hook,
});

const namespaceSchema = z.strictObject({
  id: installedNamespaceIdSchema,
  label: z.string().min(1).optional(),
  enabledBy: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .optional(),
  requires: requiresSchema.optional(),
  helper: z.boolean().optional(),
  summary: z.string(),
  rules: z.array(z.string()).max(3).optional(),
  types: z.string(),
  docs: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9][a-z0-9_/-]*$/),
        whenToRead: z.string().min(1),
        file: z.string().min(1),
      }),
    )
    .optional(),
  session: hook.optional(),
  methods: z.record(
    z.string().regex(/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/),
    methodSchema,
  ),
  configuration: hook.optional(),
  availability: hook.optional(),
});

const parametersSchema = z.looseObject({
  type: z.literal("object"),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
});

const toolBase = {
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().min(1).optional(),
  description: z.string().min(1),
  parameters: parametersSchema,
  view: extensionToolViewSchema.optional(),
  enabledBy: z.string().min(1).optional(),
  requires: requiresSchema.optional(),
  availability: hook.optional(),
};

const toolSchema = z.union([
  z.strictObject({ ...toolBase, method: z.string().min(1) }),
  z.strictObject({
    ...toolBase,
    risk,
    parse: hook,
    authorize: hook.optional(),
    run: hook,
    present: hook.optional(),
  }),
]);

/**
 * Reserved for later steps: UI contributions. Only the names of theme files are known today;
 * nothing else in `ui` is accepted yet.
 */
export const installedExtensionUiSchema = z.strictObject({
  themes: z.array(z.string().min(1)).optional(),
});

export const installedExtensionManifestSchema = z.strictObject({
  id: extensionIdSchema,
  apiVersion: z.literal(1),
  name: z.string().min(1),
  description: z.string(),
  /** A lucide name, or the path of an `.svg` file in `dist/`. */
  icon: z.string().min(1),
  enabledByDefault: z.boolean(),
  settings: settingsSchemaSchema.extend({
    version: z.number().int().positive(),
  }),
  accounts: z
    .record(z.string().min(1), accountKindSchema.omit({ kind: true }))
    .optional(),
  permissions: extensionPermissionsSchema.optional(),
  namespaces: z.array(namespaceSchema),
  tools: z.array(toolSchema).optional(),
  limits: z.record(z.string(), z.number()).optional(),
  version: semver,
  sdkVersion: semver,
  ui: installedExtensionUiSchema.optional(),
}) satisfies z.ZodType<InstalledExtensionManifest>;

/** The fields of `manifest.json` that are not part of the definition's data. */
export type InstalledExtensionManifest = ExtensionDefinitionData & {
  /** The extension's own version. */
  version: string;
  /** The exact SDK version it was built with. */
  sdkVersion: string;
  /** Reserved for UI contributions (later steps). */
  ui?: z.infer<typeof installedExtensionUiSchema>;
};

/** The definition-data part of a manifest: what the sandboxed bundle's registered definition must equal. */
export function manifestDefinitionData(
  manifest: InstalledExtensionManifest,
): ExtensionDefinitionData {
  const { version, sdkVersion, ui, ...data } = manifest;
  void version;
  void sdkVersion;
  void ui;
  return data;
}
