import { z } from "zod";
import { extensionUiLimits } from "./limits.js";
import type { ExtensionDefinitionData } from "@nervekit/extension-api/host";
import {
  accountKindDataSchema,
  extensionIdSchema,
  extensionPermissionsSchema,
  platformUseSchema,
  settingsSchemaSchema,
} from "./settings-schema.js";
import { extensionToolViewSchema } from "./tool-display.js";
import { uiContributionIdSchema } from "./ui-contribution-id.js";

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
  enabledBy: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .optional(),
  requires: requiresSchema.optional(),
  availability: hook.optional(),
};

const toolSchema = z.union([
  z.strictObject({
    ...toolBase,
    method: z.string().min(1),
    present: hook.optional(),
  }),
  z.strictObject({
    ...toolBase,
    risk,
    parse: hook,
    authorize: hook.optional(),
    run: hook,
    present: hook.optional(),
  }),
]);

const uiLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(extensionUiLimits.maxLabelLength);

/** A lucide icon name (`table`, `chart-bar`). */
const uiIconSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "must be a lucide icon name")
  .max(64);

/** A file extension with its dot, lower case: `.csv`, `.tar.gz`. */
export const previewFileExtensionSchema = z
  .string()
  .regex(
    /^\.[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/,
    "must look like .csv",
  )
  .max(extensionUiLimits.maxExtensionLength);

export const previewEditModeSchema = z.enum(["source", "custom", "none"]);

const binaryPreviewExtensions = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico", ".tiff",
  ".zip", ".gz", ".tgz", ".tar", ".7z", ".bz2", ".xz", ".wasm", ".bin", ".exe",
  ".mp3", ".wav", ".ogg", ".flac", ".mp4", ".mov", ".webm", ".mkv",
  ".woff", ".woff2", ".ttf", ".otf", ".xlsx", ".xls", ".docx", ".doc", ".pptx",
  ".sqlite", ".db", ".parquet", ".npy", ".pkl", ".glb", ".stl",
]); // prettier-ignore

/**
 * The default `edit` of a preview that does not set it: `"none"` when every matched extension is
 * a known binary format, `"source"` otherwise. The SDK build applies it, so manifests always
 * carry the resolved value.
 */
export function defaultPreviewEdit(
  extensions: readonly string[],
): "source" | "none" {
  return extensions.length > 0 &&
    extensions.every((extension) => binaryPreviewExtensions.has(extension))
    ? "none"
    : "source";
}

/** Where the build puts the frame of a preview, page or panel, relative to `dist/`. */
export const uiEntryPath = (id: string) => `ui/${id}/index.html`;
/** Where the build puts a theme file, relative to `dist/`. */
export const themeFilePath = (id: string) => `themes/${id}.json`;

const previewSchema = z
  .strictObject({
    id: uiContributionIdSchema,
    label: uiLabelSchema,
    match: z.strictObject({
      extensions: z
        .array(previewFileExtensionSchema)
        .min(1)
        .max(extensionUiLimits.maxExtensionsPerPreview),
    }),
    edit: previewEditModeSchema,
    entry: z.string(),
  })
  .refine((preview) => preview.entry === uiEntryPath(preview.id), {
    path: ["entry"],
    message: "must be ui/<id>/index.html",
  });

const frameItemShape = {
  id: uiContributionIdSchema,
  label: uiLabelSchema,
  icon: uiIconSchema,
  entry: z.string(),
};
const entryRefinement = (kind: "page" | "panel") => ({
  path: ["entry"],
  message: `${kind} entry must be ui/<id>/index.html`,
});

const pageSchema = z
  .strictObject({ ...frameItemShape, newMenu: z.boolean().default(true) })
  .refine(
    (item) => item.entry === uiEntryPath(item.id),
    entryRefinement("page"),
  );

const panelSchema = z
  .strictObject(frameItemShape)
  .refine(
    (item) => item.entry === uiEntryPath(item.id),
    entryRefinement("panel"),
  );

const themeSchema = z
  .strictObject({
    id: uiContributionIdSchema,
    label: uiLabelSchema,
    kind: z.enum(["light", "dark"]),
    file: z.string(),
  })
  .refine((theme) => theme.file === themeFilePath(theme.id), {
    path: ["file"],
    message: "must be themes/<id>.json",
  });

const uniqueIds = (items: readonly { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length;

const list = <T extends z.ZodType<{ id: string }>>(item: T) =>
  z
    .array(item)
    .max(extensionUiLimits.maxPerKind)
    .refine(uniqueIds, { message: "ids must be unique" });

/** The built UI contributions of an installed extension (paths relative to `dist/`). */
export const installedExtensionUiSchema = z.strictObject({
  previews: list(previewSchema).optional(),
  pages: list(pageSchema).optional(),
  panels: list(panelSchema).optional(),
  themes: list(themeSchema).optional(),
});

/** The credential provider an extension ships (`dist/credentials.js`); see `defineCredentialProvider`. */
export const installedExtensionCredentialsSchema = z.strictObject({
  /** Hex SHA-256 of `dist/credentials.js`: part of what the user consents to. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** The operations the provider implements; `signIn` and `apply` are required. */
  operations: z
    .array(z.enum(["signIn", "refresh", "apply", "revoke"]))
    .refine(
      (operations) =>
        operations.includes("signIn") && operations.includes("apply"),
      "A credential provider must implement signIn and apply.",
    ),
});

export const installedExtensionManifestSchema = z.strictObject({
  id: extensionIdSchema,
  name: z.string().min(1),
  description: z.string(),
  /** A lucide name, or the path of an `.svg` file in `dist/`. */
  icon: z.string().min(1),
  enabledByDefault: z.boolean(),
  settings: settingsSchemaSchema.extend({
    version: z.number().int().positive(),
  }),
  accounts: z.record(z.string().min(1), accountKindDataSchema).optional(),
  uses: z.array(platformUseSchema).optional(),
  permissions: extensionPermissionsSchema.optional(),
  namespaces: z.array(namespaceSchema),
  tools: z.array(toolSchema).optional(),
  version: semver,
  sdkVersion: semver,
  ui: installedExtensionUiSchema.optional(),
  credentials: installedExtensionCredentialsSchema.optional(),
}) satisfies z.ZodType<InstalledExtensionManifest>;

/** The fields of `manifest.json` that are not part of the definition's data. */
export type InstalledExtensionManifest = ExtensionDefinitionData & {
  /** The extension's own version. */
  version: string;
  /** The exact SDK version it was built with. */
  sdkVersion: string;
  /** UI contributions as built output (`dist/ui/<id>/`, `dist/themes/<id>.json`). */
  ui?: z.infer<typeof installedExtensionUiSchema>;
  /** The credential provider code in `dist/credentials.js`, when the extension has one. */
  credentials?: z.infer<typeof installedExtensionCredentialsSchema>;
};

/** The definition-data part of a manifest: what the sandboxed bundle's registered definition must equal. */
export function manifestDefinitionData(
  manifest: InstalledExtensionManifest,
): ExtensionDefinitionData {
  const { version, sdkVersion, ui, credentials, ...data } = manifest;
  void version;
  void sdkVersion;
  void ui;
  void credentials;
  return data;
}
