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

export function sentence(text: string): string {
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

/** The first switched-on namespace that cannot be used, helpers included. */
function failingNamespace(extension: ExtensionView): string | undefined {
  return unavailable(extension)[0]?.[0];
}

/**
 * What the user does about the problem, and the detail section that holds it.
 * The account kind comes from the failing namespace's `requiresAccount` field.
 */
export function extensionFix(
  extension: ExtensionView,
  accounts: AccountChoices,
): ExtensionFix | undefined {
  if (!extensionProblem(extension)) return undefined;
  const failing = extension.metadata.contributes.namespaces.find(
    (namespace) => namespace.id === failingNamespace(extension),
  );
  const field = failing?.requiresAccount
    ? extension.settingsSchema.fields[failing.requiresAccount]
    : undefined;
  if (field?.type !== "account")
    return { label: "Review", section: "settings" };
  const merged = mergedAccountFields(extension).has(failing!.requiresAccount!);
  return (accounts[field.kind]?.length ?? 0) === 0
    ? { label: "Add account", section: "accounts" }
    : { label: "Choose account", section: merged ? "accounts" : "settings" };
}

export type FeatureControl =
  /** The namespace's own switch, moved here from Settings. */
  | { type: "switch"; item: FieldItem }
  /** No switch of its own: the namespace loads with the extension. */
  | { type: "follows" }
  /** A tool or skill: the row opens its page. */
  | { type: "opens"; page: "tools" | "skills" }
  /** Its switch stays in Settings (placed on purpose); `on` is its state. */
  | {
      type: "setting";
      on: boolean;
      /** Section holding the field, and whether it is behind Advanced. */
      sectionId: string;
      advanced: boolean;
    };

export type FeatureRow = {
  kind: "namespace" | "tool" | "skill";
  /** The namespace id, tool name or skill name. */
  id: string;
  /** Row title: a namespace's `label ?? id`, a tool's `label`, a skill's name. */
  title: string;
  summary?: string;
  control: FeatureControl;
  /** Why the namespace or tool cannot be used, when it is switched on but cannot. */
  problem?: string;
};

/** An account field shown as the Account section, merged with its kind's list. */
export type MergedAccount = { item: FieldItem; kind: string };

export type ExtensionDetailLayout = {
  /** Account fields merged with their kind's account list; they leave Settings. */
  accounts: MergedAccount[];
  /** Settings sections without the merged account fields and the switches that moved onto Features. */
  sections: FieldSection[];
  features: FeatureRow[];
  /** Helper namespaces, named once in the Features footer. */
  helpers: string[];
};

const enabledByKeys = (enabledBy: string | string[] | undefined): string[] =>
  enabledBy === undefined
    ? []
    : Array.isArray(enabledBy)
      ? enabledBy
      : [enabledBy];

/**
 * Keys of the account fields that merge with their kind's list: the only
 * account field of the kind, with no `section`, `advanced` or `visibleWhen`
 * (the author placed those on purpose), and whose kind the extension defines.
 */
export function mergedAccountFields(extension: ExtensionView): Set<string> {
  const fields = Object.entries(extension.settingsSchema.fields).flatMap(
    ([key, field]) => (field.type === "account" ? [[key, field] as const] : []),
  );
  return new Set(
    fields
      .filter(
        ([, field]) =>
          extension.accountKinds.some((kind) => kind.kind === field.kind) &&
          field.section === undefined &&
          !field.advanced &&
          field.visibleWhen === undefined &&
          fields.filter(([, other]) => other.kind === field.kind).length === 1,
      )
      .map(([key]) => key),
  );
}

/** The reason a namespace cannot be used; nothing while it is available or not switched on. */
export function featureProblem(
  state: ExtensionView["availability"][string] | undefined,
): string | undefined {
  return state && state.configured && !state.available
    ? sentence(state.reason)
    : undefined;
}

/** Who fixed a field, from its read-only reason ("Locked by Planning" → "Planning"). */
export function lockOwner(item: FieldItem): string | undefined {
  const prefix = "Locked by ";
  return item.readOnlyReason?.startsWith(prefix)
    ? item.readOnlyReason.slice(prefix.length)
    : undefined;
}

/** "Also loads helper namespaces: atlassian, storage". */
export function helperNote(helpers: readonly string[]): string | undefined {
  return helpers.length === 0
    ? undefined
    : `Also loads helper ${helpers.length === 1 ? "namespace" : "namespaces"}: ${helpers.join(", ")}`;
}

/**
 * The detail view's layout, derived from the schema and what the extension
 * contributes. A boolean setting moves onto its namespace row as that row's
 * switch when it is the single `enabledBy` of exactly one listed namespace,
 * no `enabledBy` of another listed one, and has no `section`, `advanced` or
 * `visibleWhen` (those mean the author placed it on purpose; it stays in
 * Settings and the row shows its state). Account fields merge with their
 * kind's list (see {@link mergedAccountFields}). Features list namespaces,
 * then direct tools, then skills.
 */
export function detailLayout(
  extension: ExtensionView,
  scope: ExtensionsScope,
): ExtensionDetailLayout {
  const all = extension.metadata.contributes.namespaces;
  const listed = all.filter((namespace) => !namespace.helper);
  const sections = fieldSections(extension, scope);
  const placed = new Map<string, { sectionId: string; item: FieldItem }>();
  for (const section of sections)
    for (const item of [...section.fields, ...section.advanced])
      placed.set(item.key, { sectionId: section.id, item });

  const moves = new Set<string>();
  for (const { item } of placed.values()) {
    const { field, key } = item;
    if (
      field.type !== "boolean" ||
      field.section !== undefined ||
      field.advanced ||
      field.visibleWhen !== undefined
    )
      continue;
    const mentions = listed.filter((namespace) =>
      enabledByKeys(namespace.enabledBy).includes(key),
    );
    if (mentions.length === 1 && mentions[0]!.enabledBy === key) moves.add(key);
  }

  const merged = mergedAccountFields(extension);
  const accounts: MergedAccount[] = [];
  for (const { item } of placed.values())
    if (merged.has(item.key) && item.field.type === "account")
      accounts.push({ item, kind: item.field.kind });
  const hidden = new Set([...moves, ...merged]);

  const namespaces = listed.map((namespace): FeatureRow => {
    const problem = featureProblem(extension.availability[namespace.id]);
    const base = {
      kind: "namespace" as const,
      id: namespace.id,
      title: namespace.label ?? namespace.id,
      summary: namespace.summary,
      ...(problem ? { problem } : {}),
    };
    const keys = enabledByKeys(namespace.enabledBy);
    if (
      typeof namespace.enabledBy === "string" &&
      moves.has(namespace.enabledBy)
    )
      return {
        ...base,
        control: {
          type: "switch",
          item: placed.get(namespace.enabledBy)!.item,
        },
      };
    const first = keys.map((key) => placed.get(key)).find((entry) => entry);
    if (!first) return { ...base, control: { type: "follows" } };
    return {
      ...base,
      control: {
        type: "setting",
        on: keys.some((key) => extension.fields[key]?.value === true),
        sectionId: first.sectionId,
        advanced: first.item.field.advanced === true,
      },
    };
  });

  const { tools, skills } = extension.metadata.contributes;
  const features: FeatureRow[] = [
    ...namespaces,
    ...tools.map((tool): FeatureRow => {
      const problem = featureProblem(extension.toolAvailability?.[tool.name]);
      return {
        kind: "tool",
        id: tool.name,
        title: tool.label,
        summary: tool.description,
        control: { type: "opens", page: "tools" },
        ...(problem ? { problem } : {}),
      };
    }),
    ...skills.map(
      (skill): FeatureRow => ({
        kind: "skill",
        id: skill,
        title: skill,
        control: { type: "opens", page: "skills" },
      }),
    ),
  ];

  return {
    accounts,
    sections: sections
      .map((section) => ({
        ...section,
        fields: section.fields.filter((item) => !hidden.has(item.key)),
      }))
      .filter((section) => section.fields.length + section.advanced.length > 0),
    features,
    helpers: all.filter((namespace) => namespace.helper).map((n) => n.id),
  };
}

/** `quick_script` namespaces of the runtime itself, always present. */
export const RUNTIME_NAMESPACES = ["files", "image"] as const;

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
              ([id, state]) =>
                state.configured &&
                !extension.metadata.contributes.namespaces.some(
                  (namespace) => namespace.id === id && namespace.helper,
                ),
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
      if (
        !state.available &&
        !extension.metadata.contributes.namespaces.some(
          (entry) => entry.id === namespace && entry.helper,
        )
      )
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
