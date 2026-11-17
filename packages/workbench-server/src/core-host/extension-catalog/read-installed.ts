import { readFileSync, realpathSync, statSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  extensionIdSchema,
  installedExtensionManifestSchema,
  sdkCompatibilityProblem,
  type ExtensionCatalogDiagnostic,
  type InstalledExtensionManifest,
} from "@nervekit/contracts/extensions";
import {
  listUnignoredEntries,
  validateName,
} from "@nervekit/harness/resources";
import { resolveExtensionIcon } from "@nervekit/tools/quick-script";
import type { ExtensionIcon } from "@nervekit/contracts/extensions";

/** Largest `manifest.json` the host reads. */
export const maxManifestBytes = 1024 * 1024;
/** Largest `backend.js` the host opens in a sandbox. */
export const maxBundleBytes = 8 * 1024 * 1024;
/** Largest doc topic file the host reads. */
export const maxDocBytes = 256 * 1024;

/** What discovery found in one folder, without running any extension code. */
export type ReadExtension = {
  /** The folder's name. */
  folderName: string;
  folder: string;
  /** Present when `manifest.json` is valid and consistent with the folder. */
  manifest?: InstalledExtensionManifest;
  /** Reads a file of `dist/` by its declared path; throws on anything outside `dist/`. */
  readAsset?: (file: string) => string;
  /** The resolved icon, when the manifest is valid. */
  icon?: ExtensionIcon;
  /** Errors make the extension `invalid`; an `incompatible` one has a compatibility problem instead. */
  diagnostics: ExtensionCatalogDiagnostic[];
  /** Why the extension cannot load in this Nerve (SDK range); the manifest is valid. */
  incompatible?: string;
};

const error = (message: string): ExtensionCatalogDiagnostic => ({
  level: "error",
  message,
});

/** A reader for the files of `dist/`: relative paths that stay inside it (symbolic links included). */
export function distReader(
  dist: string,
): (file: string, maxBytes?: number) => string {
  return (file, maxBytes = maxDocBytes) => {
    if (
      file.length === 0 ||
      file.includes("\0") ||
      file.startsWith("/") ||
      file.startsWith("\\") ||
      /^[A-Za-z]:/.test(file)
    )
      throw new Error(`'${file}' is not a relative path inside dist/.`);
    const root = realpathSync(dist);
    const lexical = resolve(root, file);
    if (lexical !== root && !lexical.startsWith(root + sep))
      throw new Error(`'${file}' is outside dist/.`);
    const path = realpathSync(lexical);
    if (path !== root && !path.startsWith(root + sep))
      throw new Error(`'${file}' is outside dist/.`);
    const info = statSync(path);
    if (!info.isFile()) throw new Error(`'${file}' is not a file.`);
    if (info.size > maxBytes)
      throw new Error(`'${file}' is larger than ${maxBytes / 1024} KB.`);
    return readFileSync(path, "utf8");
  };
}

/** Reads the extension folders under `root` (each `<root>/<id>/dist/manifest.json`), honouring the root's ignore files. */
export async function readInstalledExtensions(
  root: string,
  nerveVersion: string,
): Promise<ReadExtension[]> {
  const entries = await listUnignoredEntries(root);
  const found: ReadExtension[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const folder = join(root, entry.name);
    if (!(await stat(folder).catch(() => undefined))?.isDirectory()) continue;
    found.push(await readFolder(entry.name, folder, nerveVersion));
  }
  return found;
}

/** Reads one extension folder; nothing in it runs. */
export async function readFolder(
  folderName: string,
  folder: string,
  nerveVersion: string,
): Promise<ReadExtension> {
  const result: ReadExtension = { folderName, folder, diagnostics: [] };
  const fail = (message: string) => {
    result.diagnostics.push(error(message));
    return result;
  };
  const nameProblems = [
    ...validateName(folderName, folderName),
    ...(extensionIdSchema.safeParse(folderName).success
      ? []
      : ["must start with a letter"]),
  ];
  if (nameProblems.length > 0)
    return fail(
      `The folder name '${folderName}' is not a valid extension id: ${nameProblems.join("; ")}. Use lowercase letters, digits and single hyphens (at most 64 characters), starting with a letter.`,
    );
  const dist = join(folder, "dist");
  const manifestPath = join(dist, "manifest.json");
  let text: string;
  try {
    const info = await stat(manifestPath);
    if (!info.isFile()) return fail("dist/manifest.json is not a file.");
    if (info.size > maxManifestBytes)
      return fail(
        `dist/manifest.json is larger than ${maxManifestBytes / 1024} KB.`,
      );
    // A symbolic link may not lead out of dist/.
    const real = await realpath(manifestPath);
    if (!real.startsWith((await realpath(dist)) + sep))
      return fail("dist/manifest.json is outside dist/.");
    text = await readFile(real, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT")
      return fail(
        "There is no dist/manifest.json. Build the extension (the extension-creator skill does it) so dist/ exists.",
      );
    return fail(
      `Cannot read dist/manifest.json: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return fail(
      `dist/manifest.json is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const unsupported = unsupportedFields(json);
  if (unsupported.length > 0) {
    for (const message of unsupported) result.diagnostics.push(error(message));
    return result;
  }
  const parsed = installedExtensionManifestSchema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      result.diagnostics.push(
        error(
          `dist/manifest.json: ${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
        ),
      );
    return result;
  }
  const manifest = parsed.data;
  if (manifest.id !== folderName)
    return fail(
      `The folder name '${folderName}' must equal the extension id '${manifest.id}'.`,
    );
  const readAsset = distReader(dist);
  // The icon and doc topics are plain files: they are checked now, before any consent.
  try {
    result.icon = resolveExtensionIcon(manifest, (_id, file) =>
      readAsset(file),
    );
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause));
  }
  for (const namespace of manifest.namespaces)
    for (const topic of namespace.docs ?? [])
      try {
        readAsset(topic.file);
      } catch (cause) {
        result.diagnostics.push(
          error(
            `${namespace.id}: doc topic '${topic.id}' cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
        );
      }
  if (result.diagnostics.length > 0) return result;
  result.manifest = manifest;
  result.readAsset = readAsset;
  result.incompatible = sdkCompatibilityProblem(
    manifest.sdkVersion,
    nerveVersion,
  );
  return result;
}

/** Fields of the definition that exist but are not available to installed extensions, with the reason. */
function unsupportedFields(json: unknown): string[] {
  if (json === null || typeof json !== "object") return [];
  const record = json as Record<string, unknown>;
  const settings = record.settings as Record<string, unknown> | undefined;
  return [
    ...(record.prelude !== undefined
      ? [
          "dist/manifest.json: prelude: installed extensions cannot add helper code to the script sandbox.",
        ]
      : []),
    ...(settings &&
    typeof settings === "object" &&
    settings.migrations !== undefined
      ? [
          "dist/manifest.json: settings.migrations: installed extensions cannot declare settings migrations.",
        ]
      : []),
  ];
}
