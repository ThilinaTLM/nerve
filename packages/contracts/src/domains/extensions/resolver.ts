import type { ExtensionEntry } from "./document.js";
import {
  fieldScopes,
  type ExtensionScope,
  type ExtensionSettingsDefinition,
  type SettingField,
} from "./settings-schema.js";
import { compileSettingsValidator } from "./validator.js";
import { upgradeEntry } from "./versions.js";

export type ExtensionLayerName =
  | "user"
  | "project"
  | "profile"
  | "conversation";

/** One source of entries. Order the layers lowest precedence first; a requirement layer comes last with `locked`. */
export type ExtensionLayer = {
  layer: ExtensionLayerName;
  /** Profile that contributes the layer. */
  profile?: string;
  /** Requirements win over everything and cannot be edited below. */
  locked?: boolean;
  entries: Readonly<Record<string, ExtensionEntry>>;
};

export type ValueSource = {
  layer: "default" | ExtensionLayerName;
  profile?: string;
  locked?: boolean;
};

export type ExtensionDiagnostic = {
  code:
    | "unknown-extension"
    | "newer-version"
    | "upgrade-failed"
    | "invalid-value"
    | "unknown-field"
    | "scope-not-allowed"
    /** Host-level: a settings file could not be used. */
    | "file-unavailable"
    | "untrusted-project";
  /** Absent for diagnostics about a whole file. */
  extensionId?: string;
  layer: ExtensionLayerName;
  field?: string;
  message: string;
};

export type ResolvedField = {
  value: unknown;
  source: ValueSource;
  /** False when `visibleWhen` hides it: the value is kept but ignored. */
  visible: boolean;
};

export type ResolvedExtension = {
  id: string;
  enabled: { value: boolean; source: ValueSource };
  fields: Record<string, ResolvedField>;
  /** Layers whose entry is newer than this code understands. */
  readOnlyLayers: ExtensionLayerName[];
};

export type ExtensionResolution = {
  extensions: Record<string, ResolvedExtension>;
  /** Entries of extensions that are not registered: kept, never dropped. */
  unknown: { layer: ExtensionLayerName; id: string; entry: ExtensionEntry }[];
  diagnostics: ExtensionDiagnostic[];
};

const scopeOf = (layer: ExtensionLayerName): ExtensionScope =>
  layer === "profile" ? "conversation" : layer;

function visible(
  field: SettingField,
  values: Record<string, ResolvedField>,
): boolean {
  const rule = field.visibleWhen;
  return !rule || values[rule.field]?.value === rule.equals;
}

/**
 * Per-field resolution: manifest default → user → project → profile →
 * conversation, the nearest layer that sets a field winning. Entries are
 * upgraded and validated first; what does not validate or is not allowed at
 * its scope is ignored with a diagnostic.
 */
export function resolveExtensions(
  definitions: readonly ExtensionSettingsDefinition[],
  layers: readonly ExtensionLayer[],
): ExtensionResolution {
  const diagnostics: ExtensionDiagnostic[] = [];
  const unknown: ExtensionResolution["unknown"] = [];
  const known = new Set(definitions.map((definition) => definition.id));
  for (const layer of layers)
    for (const [id, entry] of Object.entries(layer.entries))
      if (!known.has(id)) {
        unknown.push({ layer: layer.layer, id, entry });
        diagnostics.push({
          code: "unknown-extension",
          extensionId: id,
          layer: layer.layer,
          message: `Settings for unknown extension "${id}" are kept but not used.`,
        });
      }
  const extensions: Record<string, ResolvedExtension> = {};
  for (const definition of definitions) {
    const validate = compileSettingsValidator(definition.settings);
    const fields: Record<string, ResolvedField> = {};
    for (const [key, field] of Object.entries(definition.settings.fields))
      fields[key] = {
        value: "default" in field ? field.default : undefined,
        source: { layer: "default" },
        visible: true,
      };
    const resolved: ResolvedExtension = {
      id: definition.id,
      enabled: {
        value: definition.enabledByDefault,
        source: { layer: "default" },
      },
      fields,
      readOnlyLayers: [],
    };
    for (const layer of layers) {
      const stored = layer.entries[definition.id];
      if (!stored) continue;
      const source: ValueSource = {
        layer: layer.layer,
        ...(layer.profile ? { profile: layer.profile } : {}),
        ...(layer.locked ? { locked: true } : {}),
      };
      const upgrade = upgradeEntry(definition, stored);
      if (upgrade.status === "newer") {
        resolved.readOnlyLayers.push(layer.layer);
        diagnostics.push({
          code: "newer-version",
          extensionId: definition.id,
          layer: layer.layer,
          message: `Settings were saved by a newer version (${stored.version} > ${upgrade.known}); they are read-only and ignored.`,
        });
        continue;
      }
      if (upgrade.status === "failed") {
        diagnostics.push({
          code: "upgrade-failed",
          extensionId: definition.id,
          layer: layer.layer,
          message: upgrade.message,
        });
        continue;
      }
      const entry = upgrade.entry;
      if (entry.enabled !== undefined)
        resolved.enabled = { value: entry.enabled, source };
      const { value, issues } = validate(entry.settings);
      for (const issue of issues)
        diagnostics.push({
          code: issue.code,
          extensionId: definition.id,
          layer: layer.layer,
          field: issue.field,
          message: issue.message,
        });
      const invalid = new Set(issues.map((issue) => issue.field));
      for (const [key, next] of Object.entries(value)) {
        if (invalid.has(key)) continue;
        const field = definition.settings.fields[key];
        if (!fieldScopes(field).includes(scopeOf(layer.layer))) {
          diagnostics.push({
            code: "scope-not-allowed",
            extensionId: definition.id,
            layer: layer.layer,
            field: key,
            message: `"${field.label}" cannot be set at ${layer.layer} scope.`,
          });
          continue;
        }
        fields[key] = { value: next, source, visible: true };
      }
    }
    for (const [key, field] of Object.entries(definition.settings.fields))
      fields[key].visible = visible(field, fields);
    extensions[definition.id] = resolved;
  }
  return { extensions, unknown, diagnostics };
}

/** Value of a field that is visible, else undefined. */
export function fieldValue(
  extension: ResolvedExtension | undefined,
  key: string,
): unknown {
  const field = extension?.fields[key];
  return field?.visible ? field.value : undefined;
}
