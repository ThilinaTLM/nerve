import {
  fieldScopes,
  type ExtensionView,
  type SettingField,
} from "@nervekit/contracts/extensions";

/** Scopes the Extensions page edits. */
export type ExtensionsScope = "user" | "project";

export type AccountChoice = { id: string; name: string; detail?: string };
/** The user's accounts by extension account kind (`atlassian`, `tavily`). */
export type AccountChoices = Readonly<Record<string, readonly AccountChoice[]>>;

export type FieldControl =
  | "switch"
  | "input"
  | "url"
  | "number"
  | "select"
  | "account"
  | "model";

/** The control a schema field is edited with. */
export function controlFor(field: SettingField): FieldControl {
  switch (field.type) {
    case "boolean":
      return "switch";
    case "string":
      return field.format === "url" ? "url" : "input";
    case "number":
      return "number";
    case "enum":
      return "select";
    case "account":
      return "account";
    case "model":
      return "model";
  }
}

export type FieldItem = {
  key: string;
  field: SettingField;
  value: unknown;
  /** Edited here; otherwise the value is shown read-only with `readOnlyReason`. */
  editable: boolean;
  readOnlyReason?: string;
  /** The entry at this scope sets the field. */
  set: boolean;
};

export type FieldSection = {
  id: string;
  title: string;
  description?: string;
  fields: FieldItem[];
  /** Behind the Advanced disclosure. */
  advanced: FieldItem[];
};

const DEFAULT_SECTION = { id: "settings", title: "Settings" } as const;

function readOnlyReason(
  extension: ExtensionView,
  key: string,
  scope: ExtensionsScope,
): string | undefined {
  const field = extension.settingsSchema.fields[key]!;
  const source = extension.fields[key]?.source;
  if (source?.locked)
    return `Locked by ${source.profile ?? "the active profile"}`;
  if (extension.readOnly)
    return "Written by a newer version of Nerve; edit the file or update";
  if (!fieldScopes(field).includes(scope))
    return scope === "project"
      ? "Set in your user settings"
      : "Not settable in user settings";
  return undefined;
}

/**
 * The settings of an extension as the detail view lays them out: one section
 * per schema section (fields without a section first, under "Settings"),
 * hidden fields left out, advanced fields apart.
 */
export function fieldSections(
  extension: ExtensionView,
  scope: ExtensionsScope,
): FieldSection[] {
  const schema = extension.settingsSchema;
  const sections: FieldSection[] = [
    { ...DEFAULT_SECTION, fields: [], advanced: [] },
    ...(schema.sections ?? []).map((section) => ({
      ...section,
      fields: [],
      advanced: [],
    })),
  ];
  for (const [key, field] of Object.entries(schema.fields)) {
    const resolved = extension.fields[key];
    if (!resolved?.visible) continue;
    const reason = readOnlyReason(extension, key, scope);
    const item: FieldItem = {
      key,
      field,
      value: resolved.value,
      editable: reason === undefined,
      ...(reason ? { readOnlyReason: reason } : {}),
      set: extension.stored?.settings[key] !== undefined,
    };
    const section =
      sections.find((candidate) => candidate.id === field.section) ??
      sections[0]!;
    (field.advanced ? section.advanced : section.fields).push(item);
  }
  return sections.filter(
    (section) => section.fields.length + section.advanced.length > 0,
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A value as one short phrase; `undefined` when it is unset. */
export function displayValue(
  field: SettingField,
  value: unknown,
  accounts: AccountChoices,
  modelLabel?: (selection: unknown) => string | undefined,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  switch (field.type) {
    case "boolean":
      return value === true ? "On" : "Off";
    case "string":
      return field.format === "url" ? hostOf(String(value)) : String(value);
    case "number":
      return `${String(value)}${field.unit ? ` ${field.unit}` : ""}`;
    case "enum":
      return (
        field.options.find((option) => option.value === value)?.label ??
        String(value)
      );
    case "account":
      return (
        accounts[field.kind]?.find((account) => account.id === value)?.name ??
        undefined
      );
    case "model": {
      const selection = value as { provider?: string; modelId?: string };
      return (
        modelLabel?.(value) ??
        (selection.modelId
          ? `${selection.provider ?? ""}/${selection.modelId}`
          : undefined)
      );
    }
  }
}

/**
 * The row's status line: the selected account, the products switched on, then
 * other visible values: "Nerve Test · Jira, Confluence". Never On or Off.
 */
export function extensionSummary(
  extension: ExtensionView,
  accounts: AccountChoices,
): string {
  const accountParts: string[] = [];
  const enabledSwitches: string[] = [];
  const others: string[] = [];
  for (const [key, field] of Object.entries(extension.settingsSchema.fields)) {
    const resolved = extension.fields[key];
    if (!resolved?.visible || field.advanced) continue;
    if (field.type === "boolean") {
      if (resolved.value === true) enabledSwitches.push(field.label);
      continue;
    }
    const text = displayValue(field, resolved.value, accounts);
    if (!text) continue;
    (field.type === "account" ? accountParts : others).push(text);
  }
  const parts = [
    ...accountParts,
    ...(enabledSwitches.length > 0 ? [enabledSwitches.join(", ")] : []),
    ...others,
  ];
  return parts.length > 0 ? parts.join(" · ") : extension.metadata.description;
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Namespaces the extension offers that are switched on but cannot be used. */
function unavailable(extension: ExtensionView) {
  return Object.entries(extension.availability).filter(
    ([, state]) => state.configured && !state.available,
  );
}

/** The agent's reason, when the extension is on but a namespace cannot be used. */
export function extensionProblem(extension: ExtensionView): string | undefined {
  if (!extension.enabled.value) return undefined;
  const [first] = unavailable(extension);
  if (!first) return undefined;
  const [, state] = first;
  return state.available ? undefined : sentence(state.reason);
}

export type ExtensionFix = { label: string; section: string };

/** What the user does about the problem, and the detail section that holds it. */
export function extensionFix(
  extension: ExtensionView,
  accounts: AccountChoices,
): ExtensionFix | undefined {
  if (!extensionProblem(extension)) return undefined;
  const kind = extension.accountKinds[0]?.kind;
  if (!kind) return { label: "Review", section: "settings" };
  return (accounts[kind]?.length ?? 0) === 0
    ? { label: "Add account", section: "accounts" }
    : { label: "Choose account", section: "settings" };
}

/** `quick_script` namespaces of the runtime itself, always present. */
export const RUNTIME_NAMESPACES = ["files", "image"] as const;
/** Namespaces that only support another one; not listed to the user. */
const HELPER_NAMESPACES = new Set(["atlassian", "storage"]);

/** Every namespace the extension contributes with its availability, helpers included. */
export function contributedNamespaces(extension: ExtensionView) {
  return extension.metadata.contributes.namespaces.map((namespace) => ({
    ...namespace,
    state: extension.availability[namespace.id],
  }));
}

/** Names the Quick script row lists: the runtime's plus every switched-on extension namespace. */
export function activeNamespaces(
  extensions: readonly ExtensionView[],
): string[] {
  return [
    ...RUNTIME_NAMESPACES,
    ...extensions.flatMap((extension) =>
      extension.enabled.value
        ? Object.entries(extension.availability)
            .filter(
              ([id, state]) => state.configured && !HELPER_NAMESPACES.has(id),
            )
            .map(([id]) => id)
        : [],
    ),
  ];
}

/** The first switched-on namespace that cannot be used, with its extension. */
export function namespaceProblem(
  extensions: readonly ExtensionView[],
): { extensionId: string; namespace: string; text: string } | undefined {
  for (const extension of extensions) {
    if (!extension.enabled.value) continue;
    for (const [namespace, state] of unavailable(extension))
      if (!state.available && !HELPER_NAMESPACES.has(namespace))
        return {
          extensionId: extension.metadata.id,
          namespace,
          text: sentence(state.reason),
        };
  }
  return undefined;
}

export type ExtensionChange = {
  /** A settings key, or `enabled`. */
  key: string;
  label: string;
  from: string;
  to: string;
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * What this scope's entry changes against where the value would otherwise come
 * from: the schema default in user settings, the user's resolved value in a
 * project. Only values the entry sets can differ.
 */
export function extensionChanges(
  extension: ExtensionView,
  scope: ExtensionsScope,
  accounts: AccountChoices,
  inherited?: ExtensionView,
  modelLabel?: (selection: unknown) => string | undefined,
): ExtensionChange[] {
  const stored = extension.stored;
  if (!stored || (scope === "project" && !inherited)) return [];
  const changes: ExtensionChange[] = [];
  if (stored.enabled !== undefined) {
    const base =
      scope === "project" && inherited
        ? inherited.enabled.value
        : extension.metadata.enabledByDefault;
    if (stored.enabled !== base)
      changes.push({
        key: "enabled",
        label: "Enabled",
        from: base ? "On" : "Off",
        to: stored.enabled ? "On" : "Off",
      });
  }
  for (const [key, field] of Object.entries(extension.settingsSchema.fields)) {
    const value = stored.settings[key];
    if (value === undefined) continue;
    const base =
      scope === "project"
        ? inherited?.fields[key]?.value
        : "default" in field
          ? field.default
          : undefined;
    if (same(value, base)) continue;
    changes.push({
      key,
      label: field.label,
      from: displayValue(field, base, accounts, modelLabel) ?? "Not set",
      to: displayValue(field, value, accounts, modelLabel) ?? "Not set",
    });
  }
  return changes;
}

/** The entry with `key` set to `value`, or removed when `value` is undefined. */
export function entryWithSetting(
  extension: ExtensionView,
  key: string,
  value: unknown,
): { enabled?: boolean; settings: Record<string, unknown> } {
  const settings = { ...(extension.stored?.settings ?? {}) };
  if (value === undefined) delete settings[key];
  else settings[key] = value;
  return {
    ...(extension.stored?.enabled !== undefined
      ? { enabled: extension.stored.enabled }
      : {}),
    settings,
  };
}

/** The entry with the switch set. */
export function entryWithEnabled(
  extension: ExtensionView,
  enabled: boolean,
): { enabled: boolean; settings: Record<string, unknown> } {
  return { enabled, settings: { ...(extension.stored?.settings ?? {}) } };
}

/** Parses a number input; blank clears the value, garbage is rejected. */
export function parseNumberInput(text: string): number | undefined | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : "invalid";
}
