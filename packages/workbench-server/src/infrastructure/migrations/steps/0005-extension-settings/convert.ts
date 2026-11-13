/**
 * Frozen conversion of account choices and tool options from agent
 * configuration into extension settings. Plain-JSON shapes only: this step
 * must not follow later changes to the evolving contracts.
 */
export type Json = Record<string, unknown>;
export type Entry = {
  version: 1;
  enabled?: boolean;
  settings?: Record<string, unknown>;
};
export type Entries = Record<string, Entry>;
export type Loss = (reason: string) => void;

export const KROKI_DEFAULT = "https://kroki.io/";

export const isRecord = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);
const omit = (value: Json, key: string): Json =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
const string = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;
const boolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

/**
 * Moves the fields out of one `tools` object: Jira/Confluence accounts and
 * switches (the `quick_script` value wins over the direct-tool value), the
 * Tavily account and the Kroki server. `complete` marks a frozen full
 * configuration, where values equal to the default are not worth keeping.
 */
export function extractFromTools(
  tools: unknown,
  loss: Loss,
  complete = false,
): { tools: Json | undefined; entries: Entries } {
  if (!isRecord(tools)) return { tools: undefined, entries: {} };
  // Nothing to move (also what a second run sees): leave the tools as they are.
  if (!hasMovedFields(tools)) return { tools, entries: {} };
  const quickScript = isRecord(tools.quick_script)
    ? tools.quick_script
    : undefined;
  const qs = isRecord(quickScript?.settings) ? quickScript.settings : {};
  const sub = (value: unknown): Json => (isRecord(value) ? value : {});

  const entries: Entries = {};
  const product = (name: "jira" | "confluence") => ({
    enabled:
      boolean(sub(qs[name]).enabled) ?? boolean(sub(tools[name]).enabled),
    account:
      string(sub(qs[name]).profileId) ?? string(sub(tools[name]).profileId),
  });
  const jira = product("jira");
  const confluence = product("confluence");
  if (jira.account && confluence.account && jira.account !== confluence.account)
    loss(
      "Jira and Confluence used different Atlassian accounts; the Jira account was kept",
    );
  const account = jira.account ?? confluence.account;
  const settings: Record<string, unknown> = {};
  if (account) settings.account = account;
  if (jira.enabled !== undefined) settings.jira = jira.enabled;
  if (confluence.enabled !== undefined)
    settings.confluence = confluence.enabled;
  if (Object.keys(settings).length)
    entries.atlassian = {
      version: 1,
      ...(jira.enabled || confluence.enabled ? { enabled: true } : {}),
      settings,
    };

  const web = sub(qs.web);
  const searchAccount =
    string(web.profileId) ?? string(sub(tools.web_search).profileId);
  const webEnabled = boolean(web.enabled);
  if (searchAccount || webEnabled !== undefined)
    entries.web = {
      version: 1,
      ...(webEnabled !== undefined ? { enabled: webEnabled } : {}),
      ...(searchAccount ? { settings: { searchAccount } } : {}),
    };

  const server =
    string(sub(qs.diagram).url) ??
    string(sub(sub(tools.kroki_export).settings).url);
  if (server && !(complete && server === KROKI_DEFAULT))
    entries.diagram = { version: 1, settings: { server } };

  const cleaned: Json = {};
  for (const [name, entry] of Object.entries(tools)) {
    const drop =
      name === "jira" || name === "confluence" || name === "web_search"
        ? "profileId"
        : name === "quick_script" || name === "kroki_export"
          ? "settings"
          : undefined;
    if (drop && isRecord(entry)) {
      const rest = omit(entry, drop);
      if (Object.keys(rest).length) cleaned[name] = rest;
    } else cleaned[name] = entry;
  }
  return {
    tools: Object.keys(cleaned).length ? cleaned : undefined,
    entries,
  };
}

/** Later entries win per field. */
export function mergeEntries(base: Entries, over: Entries): Entries {
  const merged: Entries = structuredClone(base);
  for (const [id, entry] of Object.entries(over)) {
    const current = merged[id];
    merged[id] = {
      version: 1,
      ...(entry.enabled !== undefined
        ? { enabled: entry.enabled }
        : current?.enabled !== undefined
          ? { enabled: current.enabled }
          : {}),
      ...(current?.settings || entry.settings
        ? { settings: { ...current?.settings, ...entry.settings } }
        : {}),
    };
  }
  return merged;
}

/** Returns `value` with `tools` replaced (or removed) in `section`. */
function withTools(
  value: Json,
  section: string,
  tools: Json | undefined,
): Json {
  const holder = value[section];
  if (!isRecord(holder)) return value;
  return {
    ...value,
    [section]: { ...omit(holder, "tools"), ...(tools ? { tools } : {}) },
  };
}

/** `{ overrides: { tools } }` documents (agent settings, conversation overrides). */
function convertOverrides(
  document: Json,
  loss: Loss,
): { document: Json; entries: Entries } {
  const overrides = isRecord(document.overrides)
    ? document.overrides
    : undefined;
  if (!overrides || !isRecord(overrides.tools))
    return { document, entries: {} };
  const { tools, entries } = extractFromTools(overrides.tools, loss);
  return { document: withTools(document, "overrides", tools), entries };
}

export function convertUserAgent(
  document: Json,
  loss: Loss,
): { document: Json; entries: Entries } {
  return convertOverrides(document, loss);
}

/** Profile contribution entries from `recommendations`/`requirements` tools. A requirement wins over a recommendation for the same field. */
function profileSections(
  holder: Json,
  loss: Loss,
): { holder: Json; extensions?: Json } {
  let next = holder;
  const sections: Record<string, Entries> = {};
  for (const section of ["recommendations", "requirements"] as const) {
    const part = next[section];
    if (!isRecord(part) || !isRecord(part.tools)) continue;
    const { tools, entries } = extractFromTools(part.tools, loss);
    next = withTools(next, section, tools);
    if (Object.keys(entries).length) sections[section] = entries;
  }
  const required = sections.requirements;
  const recommended = sections.recommendations;
  if (required && recommended)
    for (const [id, entry] of Object.entries(required)) {
      const other = recommended[id];
      if (!other) continue;
      if (entry.enabled !== undefined && other.enabled !== undefined) {
        delete other.enabled;
        loss(
          "A profile recommended and required the same extension switch; the requirement was kept",
        );
      }
      for (const key of Object.keys(entry.settings ?? {}))
        if (other.settings && key in other.settings) {
          delete other.settings[key];
          loss(
            "A profile recommended and required the same extension setting; the requirement was kept",
          );
        }
      if (
        other.enabled === undefined &&
        !Object.keys(other.settings ?? {}).length
      )
        delete recommended[id];
    }
  return Object.keys(sections).length
    ? { holder: next, extensions: sections }
    : { holder };
}

/** A user or project profile definition (`recommendations`/`requirements` at the top level). */
export function convertProfileDefinition(definition: Json, loss: Loss): Json {
  const { holder, extensions } = profileSections(definition, loss);
  return extensions && !isRecord(holder.extensions)
    ? { ...holder, extensions }
    : holder;
}

/** A conversation's `config/agent.json`: lead or child (child has `frozenDefaults`). */
export function convertConversationAgent(
  document: Json,
  loss: Loss,
): { document: Json; entries: Entries } {
  let next = document;
  let entries: Entries = {};
  if (isRecord(next.frozenDefaults) && isRecord(next.frozenDefaults.tools)) {
    const frozen = extractFromTools(next.frozenDefaults.tools, loss, true);
    next = withTools(next, "frozenDefaults", frozen.tools);
    entries = frozen.entries;
  }
  const overrides = convertOverrides(next, loss);
  next = overrides.document;
  entries = mergeEntries(entries, overrides.entries);
  if (isRecord(next.appliedProfile)) {
    const { holder, extensions } = profileSections(next.appliedProfile, loss);
    next = {
      ...next,
      appliedProfile:
        extensions && !isRecord(holder.extensions)
          ? { ...holder, extensions }
          : holder,
    };
  }
  return { document: next, entries };
}

/** Whether a tools object still carries a moved field. */
export function hasMovedFields(tools: unknown): boolean {
  if (!isRecord(tools)) return false;
  return (
    ["jira", "confluence", "web_search"].some(
      (name) => isRecord(tools[name]) && "profileId" in tools[name],
    ) ||
    ["quick_script", "kroki_export"].some(
      (name) => isRecord(tools[name]) && "settings" in tools[name],
    )
  );
}
