import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  nerveHomeManifestSchema,
  type NerveHomeManifest,
} from "@nervekit/contracts";
import { pathExists } from "./json.js";

export const NERVE_HOME_FORMAT = "nerve-home";
export const NERVE_HOME_VERSION = 1;

export type NerveHomeInspection =
  | { kind: "missing" | "empty" }
  | { kind: "current"; manifest: NerveHomeManifest }
  | { kind: "unsupported"; reason: string };

/**
 * Inspect only the root directory and manifest. No other in-home file is opened
 * before the manifest has identified the layout.
 */
export async function inspectNerveHome(
  home: string,
): Promise<NerveHomeInspection> {
  let entries;
  try {
    entries = await readdir(home, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { kind: "missing" };
    throw error;
  }

  const manifestPath = join(home, "manifest.json");
  if (!(await pathExists(manifestPath))) {
    if (entries.length === 0) return { kind: "empty" };
    return {
      kind: "unsupported",
      reason:
        "NERVE_HOME is non-empty and has no nerve-home manifest.json. This version does not import older storage layouts; preserve the directory and use an empty NERVE_HOME.",
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return {
      kind: "unsupported",
      reason: "The Nerve home manifest.json is unreadable or invalid JSON.",
    };
  }
  const parsed = nerveHomeManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "unsupported",
      reason: `The Nerve home manifest is not ${NERVE_HOME_FORMAT} version ${NERVE_HOME_VERSION}.`,
    };
  }
  return { kind: "current", manifest: parsed.data };
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
