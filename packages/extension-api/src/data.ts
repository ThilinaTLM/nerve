/* eslint-disable @typescript-eslint/no-explicit-any -- the projection walks definitions of any shape */
import type { ExtensionDefinition } from "./types.js";

/**
 * The plain-data shape of a definition: every hook (a function) is replaced by `true`, so the
 * data says which hooks exist without running or including their code.
 */
export type ExtensionData<T> = T extends (...args: any[]) => unknown
  ? true
  : T extends readonly (infer U)[]
    ? ExtensionData<U>[]
    : T extends object
      ? { [K in keyof T]: ExtensionData<T[K]> }
      : T;

/**
 * What `manifest.json` carries of a definition (see `extensionDefinitionData`). `ui` is not part
 * of it: the definition names source files, the manifest's own `ui` names the built output.
 */
export type ExtensionDefinitionData = ExtensionData<
  Omit<ExtensionDefinition, "ui">
>;

function toData(value: unknown): unknown {
  if (typeof value === "function") return true;
  if (Array.isArray(value)) return value.map(toData);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      out[key] = toData(entry);
    }
    return out;
  }
  return value;
}

/**
 * The plain-data part of a definition, as `nerve-ext build` writes it to `dist/manifest.json`:
 * hooks (`parse`, `authorize`, `run`, `present`, `session`, `configuration`, `availability`,
 * `test`, settings `migrations`) become `true`, everything else is kept; `ui` is left out. The host compares it
 * with the data of the definition the extension's code registers, so the manifest cannot
 * understate what the code does.
 */
export function extensionDefinitionData(
  definition: ExtensionDefinition,
): ExtensionDefinitionData {
  const { ui, ...rest } = definition;
  void ui;
  return toData(rest) as ExtensionDefinitionData;
}
