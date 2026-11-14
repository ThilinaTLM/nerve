// Tool keys that moved into extension settings (`extensions.json`) and tools
// that were removed in favour of `quick_script` namespaces (Jira, Confluence,
// Diagram export, Image generation). Project files are not converted across
// files; the same-file version bump drops these entries and the upgrade
// notice asks the user to set them again.
type Tools = Record<string, unknown>;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const MOVED: Readonly<Record<string, string>> = {
  web_search: "profileId",
  quick_script: "settings",
};
/** Removed tools: the whole entry goes. */
const REMOVED: ReadonlySet<string> = new Set([
  "jira",
  "confluence",
  "generate_image",
  "kroki_export",
]);

const omit = (value: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

/** Removes moved keys from one `tools` map and lists what was dropped. */
export function withoutMovedToolKeys(tools: Tools): {
  tools: Tools;
  dropped: string[];
} {
  const next: Tools = {};
  const dropped: string[] = [];
  for (const [name, entry] of Object.entries(tools)) {
    if (REMOVED.has(name)) {
      dropped.push(`tools.${name}`);
      continue;
    }
    const key = MOVED[name];
    if (key && record(entry) && Object.hasOwn(entry, key)) {
      const rest = omit(entry, key);
      dropped.push(`tools.${name}.${key}`);
      if (Object.keys(rest).length) next[name] = rest;
    } else next[name] = entry;
  }
  return { tools: next, dropped };
}

function mapTools(
  holder: unknown,
  dropped: string[],
): Record<string, unknown> | undefined {
  if (!record(holder) || !record(holder.tools)) return undefined;
  const result = withoutMovedToolKeys(holder.tools);
  dropped.push(...result.dropped);
  return {
    ...omit(holder, "tools"),
    ...(Object.keys(result.tools).length ? { tools: result.tools } : {}),
  };
}

/** `{ overrides: { tools } }` documents: agent settings and capabilities. */
export function dropMovedFromOverrides(value: unknown): {
  value: unknown;
  dropped: string[];
} {
  const dropped: string[] = [];
  if (!record(value)) return { value, dropped };
  const overrides = mapTools(value.overrides, dropped);
  return { value: overrides ? { ...value, overrides } : value, dropped };
}

/** Profile definitions: `recommendations` and `requirements` hold `tools`. */
export function dropMovedFromProfile(value: unknown): {
  value: unknown;
  dropped: string[];
} {
  const dropped: string[] = [];
  if (!record(value)) return { value, dropped };
  const next: Record<string, unknown> = { ...value };
  for (const section of ["recommendations", "requirements"])
    if (Object.hasOwn(value, section)) {
      const mapped = mapTools(value[section], dropped);
      if (mapped) next[section] = mapped;
    }
  return { value: next, dropped };
}

export const movedKeysNotice =
  "Settings for Jira, Confluence, Image generation, Diagram export and Web search moved to Extensions (Jira, Confluence, diagrams and images are now reached through quick_script); they were removed from this file. Set them again in project settings.";
