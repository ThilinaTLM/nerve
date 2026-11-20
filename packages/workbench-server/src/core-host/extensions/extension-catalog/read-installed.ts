import { agentTextProblems } from "./agent-text-limits.js";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  extensionIdSchema,
  installedExtensionManifestSchema,
  installedNamingDiagnostics,
  sdkCompatibilityProblem,
  usedExtensionSurfaces,
  themeFileSchema,
  themeRuleProblems,
  type InstalledExtensionManifest,
  type ThemeFile,
} from "@nervekit/contracts/extensions";
import type { Diagnostic } from "@nervekit/contracts/configuration";
import {
  listUnignoredEntries,
  validateName,
} from "@nervekit/harness/resources";
import { resolveExtensionIcon } from "@nervekit/tools/extension-host";
import type { ExtensionIcon } from "@nervekit/contracts/extensions";

/** Largest `manifest.json` the host reads. */
export const maxManifestBytes = 1024 * 1024;
/** Largest `backend.js` the host opens in a sandbox. */
export const maxBundleBytes = 8 * 1024 * 1024;
/** Largest doc topic file the host reads. */
export const maxDocBytes = 256 * 1024;

/** Largest theme file the host reads. */
export const maxThemeBytes = 16 * 1024;

/** A theme the manifest declares: the validated file, or why it cannot be offered. */
export type ReadTheme =
  | { id: string; theme: ThemeFile }
  | { id: string; problems: string[] };

/** What discovery found in one folder, without running any extension code. */
export type ReadExtension = {
  /** The folder's name. */
  folderName: string;
  folder: string;
  /** Present when `manifest.json` is valid and consistent with the folder. */
  manifest?: InstalledExtensionManifest;
  /** Reads a file of `dist/` by its declared path; throws on anything outside `dist/`. */
  readAsset?: (file: string) => string;
  /** The themes the manifest declares, read and checked against the theme file schema and the readability rules. */
  themes?: ReadTheme[];
  /** The resolved icon, when the manifest is valid. */
  icon?: ExtensionIcon;
  /** Errors make the extension `invalid`; an `incompatible` one has a compatibility problem instead. */
  diagnostics: Diagnostic[];
  /** Why the extension cannot load in this Nerve (SDK range). Then `manifest` is absent: it was never parsed. */
  incompatible?: string;
  /** The SDK version the manifest names, when it is a string (read before the manifest is parsed). */
  sdkVersion?: string;
};

const error = (code: string, message: string): Diagnostic => ({
  level: "error",
  code,
  message,
});

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

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
    if (!isInside(root, lexical))
      throw new Error(`'${file}' is outside dist/.`);
    const path = realpathSync(lexical);
    if (!isInside(root, path)) throw new Error(`'${file}' is outside dist/.`);
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
  const fail = (code: string, message: string) => {
    result.diagnostics.push(error(code, message));
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
      "invalid-folder-name",
      `The folder name '${folderName}' is not a valid extension id: ${nameProblems.join("; ")}. Use lowercase letters, digits and single hyphens (at most 64 characters), starting with a letter.`,
    );
  const dist = join(folder, "dist");
  const manifestPath = join(dist, "manifest.json");
  let text: string;
  try {
    const info = await stat(manifestPath);
    if (!info.isFile())
      return fail("manifest-unreadable", "dist/manifest.json is not a file.");
    if (info.size > maxManifestBytes)
      return fail(
        "manifest-too-large",
        `dist/manifest.json is larger than ${maxManifestBytes / 1024} KB.`,
      );
    // A symbolic link may not lead out of dist/.
    const real = await realpath(manifestPath);
    if (!isInside(await realpath(dist), real))
      return fail(
        "manifest-unreadable",
        "dist/manifest.json is outside dist/.",
      );
    text = await readFile(real, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT")
      return fail(
        "not-built",
        "This folder has no dist/manifest.json, so it is not built. Ask the agent in the Forge profile to build it (the configure-nerve skill covers it). Nerve never builds or installs an extension itself.",
      );
    return fail(
      "manifest-unreadable",
      `Cannot read dist/manifest.json: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return fail(
      "manifest-invalid",
      `dist/manifest.json is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  // The SDK version decides first: a manifest from a newer or much older SDK may not fit this
  // Nerve's schema, and the useful message is to upgrade, not a list of unknown fields.
  const builtWith = (json as { sdkVersion?: unknown } | null)?.sdkVersion;
  if (typeof builtWith === "string") {
    result.sdkVersion = builtWith;
    const incompatible = sdkCompatibilityProblem(
      builtWith,
      nerveVersion,
      usedExtensionSurfaces(json),
    );
    if (incompatible) {
      result.incompatible = incompatible;
      return result;
    }
  }
  const unsupported = unsupportedFields(json);
  if (unsupported.length > 0) {
    for (const message of unsupported)
      result.diagnostics.push(error("manifest-invalid", message));
    return result;
  }
  const parsed = installedExtensionManifestSchema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      result.diagnostics.push(
        error(
          "manifest-invalid",
          `dist/manifest.json: ${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
        ),
      );
    return result;
  }
  const manifest = parsed.data;
  if (manifest.id !== folderName)
    return fail(
      "folder-id-mismatch",
      `The folder name '${folderName}' must equal the extension id '${manifest.id}'.`,
    );
  const naming = installedNamingDiagnostics(manifest);
  if (naming.length > 0) {
    result.diagnostics.push(...naming);
    return result;
  }
  const readAsset = distReader(dist);
  // The icon and doc topics are plain files: they are checked now, before any consent.
  try {
    result.icon = resolveExtensionIcon(manifest, (_id, file) =>
      readAsset(file),
    );
  } catch (cause) {
    return fail(
      "icon-invalid",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  for (const namespace of manifest.namespaces)
    for (const topic of namespace.docs ?? [])
      try {
        readAsset(topic.file);
      } catch (cause) {
        result.diagnostics.push(
          error(
            "doc-unreadable",
            `${namespace.id}: doc topic '${topic.id}' cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
        );
      }
  // Text a model reads is bounded before consent: over the limit, the extension is invalid.
  if (result.diagnostics.length === 0)
    for (const problem of agentTextProblems(manifest, readAsset))
      result.diagnostics.push(error("agent-text-too-long", problem));
  if (result.diagnostics.length > 0) return result;
  result.manifest = manifest;
  result.readAsset = readAsset;
  result.themes = (manifest.ui?.themes ?? []).map((declared) =>
    readTheme(declared, readAsset),
  );
  return result;
}

/**
 * Reads and checks one theme file. A theme that fails is not offered and says why; it does not
 * make the extension invalid (a theme is data, and the rest of the extension still works).
 */
function readTheme(
  declared: { id: string; kind: "light" | "dark"; file: string },
  readAsset: (file: string, maxBytes?: number) => string,
): ReadTheme {
  const fail = (...problems: string[]): ReadTheme => ({
    id: declared.id,
    problems,
  });
  let json: unknown;
  try {
    json = JSON.parse(readAsset(declared.file, maxThemeBytes));
  } catch (cause) {
    return fail(
      `${declared.file} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const parsed = themeFileSchema.safeParse(json);
  if (!parsed.success)
    return fail(
      ...parsed.error.issues.map(
        (issue) =>
          `${declared.file}: ${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
      ),
    );
  const theme = parsed.data;
  if (theme.id !== declared.id || theme.kind !== declared.kind)
    return fail(
      `${declared.file} says id '${theme.id}' and kind '${theme.kind}'; the manifest says '${declared.id}' and '${declared.kind}'.`,
    );
  const problems = themeRuleProblems(theme.kind, theme.tokens);
  return problems.length > 0 ? fail(...problems) : { id: theme.id, theme };
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
