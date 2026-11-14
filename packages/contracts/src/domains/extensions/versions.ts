import type { ExtensionEntry } from "./document.js";
import type { ExtensionSettingsDefinition } from "./settings-schema.js";

export type EntryUpgrade =
  | { status: "current"; entry: ExtensionEntry }
  | { status: "upgraded"; entry: ExtensionEntry; from: number }
  /** Written by newer code: read-only, never overwritten. */
  | { status: "newer"; entry: ExtensionEntry; known: number }
  | { status: "failed"; entry: ExtensionEntry; message: string };

/**
 * Brings one stored entry to the extension's `settingsVersion` by applying
 * `migrations[n]` (n-1 → n) in order. Runs on read; callers write the result
 * back only when that scope is next saved.
 */
export function upgradeEntry(
  definition: Pick<
    ExtensionSettingsDefinition,
    "settingsVersion" | "migrations"
  >,
  entry: ExtensionEntry,
): EntryUpgrade {
  const known = definition.settingsVersion;
  if (entry.version > known) return { status: "newer", entry, known };
  if (entry.version === known) return { status: "current", entry };
  let settings = entry.settings;
  try {
    for (let next = entry.version + 1; next <= known; next++) {
      const migrate = definition.migrations?.[next];
      if (!migrate)
        return {
          status: "failed",
          entry,
          message: `No migration from settings version ${next - 1} to ${next}.`,
        };
      if (settings) settings = migrate(structuredClone(settings));
    }
  } catch (error) {
    return {
      status: "failed",
      entry,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    status: "upgraded",
    from: entry.version,
    entry: {
      version: known,
      ...(entry.enabled !== undefined ? { enabled: entry.enabled } : {}),
      ...(settings ? { settings } : {}),
    },
  };
}
