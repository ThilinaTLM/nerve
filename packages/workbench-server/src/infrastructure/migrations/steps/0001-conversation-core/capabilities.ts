import assert from "node:assert/strict";
import { defaults } from "./capability-defaults.js";
import type { Legacy } from "./legacy.reader.js";

export interface CapabilitySelection {
  disabledTools: string[];
  toolProfiles: Record<string, string>;
  toolSettings: Legacy;
  disabledFileSkills: string[];
  enabledNerveSkills: string[];
  enabledAgentBrowserSkills: string[];
}
interface Document {
  schemaVersion: 2;
  tools: Record<string, { enabled?: boolean; profileId?: string }>;
  toolSettings: Legacy;
  skills: Record<"file" | "nerve" | "agentBrowser", Record<string, boolean>>;
}
const groups = [
  "subagent_new",
  "subagent_prompt",
  "subagent_list",
  "subagent_status",
  "subagent_stop",
];
const configurable = [
  "explore",
  "explain_image",
  "generate_image",
  "kroki_export",
  "subagents",
];
const profiled = ["jira", "confluence", "web_search"];
export const toolNames = new Set([
  ...configurable,
  ...profiled,
  "web_fetch",
  "python_exec",
]);
const kinds = ["file", "nerve", "agentBrowser"] as const;
const empty = (): Document => ({
  schemaVersion: 2,
  tools: {},
  toolSettings: {},
  skills: { file: {}, nerve: {}, agentBrowser: {} },
});

/** Frozen v1→v2 reader and capability ladder; credentials are never copied. */
export const capabilityOverridesDocumentSchema = {
  parse(raw: Legacy): Document {
    assert(raw && [1, 2].includes(raw.schemaVersion));
    const document = empty(),
      tools = { ...(raw.tools ?? {}) };
    if (raw.schemaVersion === 1) {
      const old = groups.filter((name) => Object.hasOwn(tools, name));
      if (old.length) {
        assert(old.every((name) => typeof tools[name] === "boolean"));
        tools.subagents ??=
          old.length === groups.length && old.every((name) => tools[name]);
        for (const name of old) delete tools[name];
      }
    }
    for (const [name, value] of Object.entries(tools)) {
      assert(toolNames.has(name), `Unknown capability tool ${name}`);
      const entry =
        typeof value === "boolean" && raw.schemaVersion === 1
          ? { enabled: value }
          : (value as Legacy);
      assert(
        entry &&
          typeof entry === "object" &&
          (typeof entry.enabled === "boolean" ||
            typeof entry.profileId === "string"),
      );
      if (entry.profileId !== undefined)
        assert(profiled.includes(name) && entry.profileId.trim().length > 0);
      document.tools[name] = { ...entry };
    }
    for (const [name, settings] of Object.entries(raw.toolSettings ?? {})) {
      assert(
        configurable.includes(name) && settings && typeof settings === "object",
      );
      document.toolSettings[name] = settings;
    }
    for (const kind of kinds) {
      const entries = Object.entries(raw.skills?.[kind] ?? {});
      assert(entries.length <= 512);
      for (const [name, enabled] of entries) {
        assert(
          name.trim().length &&
            name.length <= 256 &&
            typeof enabled === "boolean",
        );
        document.skills[kind][name.trim()] = enabled;
      }
    }
    return document;
  },
};
export function userCapabilitySelection(
  harness: Legacy,
  integrations: Legacy,
): CapabilitySelection {
  const raw = harness.tools?.disabled ?? defaults.disabledTools;
  const disabled = new Set<string>(
    raw.filter((name: string) => !groups.includes(name)),
  );
  if (raw.some((name: string) => groups.includes(name)))
    disabled.add("subagents");
  const profiles: Record<string, string> = {};
  for (const name of ["jira", "confluence"]) {
    const tool = integrations.tools?.[name];
    if (!tool?.enabled) disabled.add(name);
    else disabled.delete(name);
    if (tool?.profileId) profiles[name] = tool.profileId;
  }
  if (integrations.tools?.web?.tavilyProfileId)
    profiles.web_search = integrations.tools.web.tavilyProfileId;
  return {
    disabledTools: [...disabled],
    toolProfiles: profiles,
    toolSettings: {
      explore: harness.exploreAgent ?? defaults.toolSettings.explore,
      subagents: harness.asyncSubagent ?? defaults.toolSettings.subagents,
      explain_image:
        harness.tools?.imageExplanation ?? defaults.toolSettings.explain_image,
      generate_image:
        harness.tools?.imageGeneration ?? defaults.toolSettings.generate_image,
      kroki_export: harness.tools?.kroki ?? defaults.toolSettings.kroki_export,
    },
    disabledFileSkills: harness.skills?.disabled ?? defaults.disabledFileSkills,
    enabledNerveSkills:
      harness.skills?.nerve?.enabled ?? defaults.enabledNerveSkills,
    enabledAgentBrowserSkills:
      harness.skills?.agentBrowser?.enabled ??
      defaults.enabledAgentBrowserSkills,
  };
}
export function resolveCapabilitySelection(input: {
  user: CapabilitySelection;
  project?: Document;
  conversation?: Document;
}): CapabilitySelection {
  const disabledTools = new Set(input.user.disabledTools),
    toolProfiles = { ...input.user.toolProfiles },
    toolSettings = { ...input.user.toolSettings };
  const sets = {
    file: new Set(input.user.disabledFileSkills),
    nerve: new Set(input.user.enabledNerveSkills),
    agentBrowser: new Set(input.user.enabledAgentBrowserSkills),
  };
  for (const document of [input.project, input.conversation]) {
    if (!document) continue;
    for (const [name, entry] of Object.entries(document.tools)) {
      if (entry.enabled === true) disabledTools.delete(name);
      else if (entry.enabled === false) disabledTools.add(name);
      if (profiled.includes(name)) {
        if (entry.profileId !== undefined) toolProfiles[name] = entry.profileId;
        else delete toolProfiles[name];
      }
    }
    Object.assign(toolSettings, document.toolSettings);
    for (const kind of kinds)
      for (const [name, enabled] of Object.entries(document.skills[kind])) {
        if (enabled === (kind !== "file")) sets[kind].add(name);
        else sets[kind].delete(name);
      }
  }
  return {
    disabledTools: [...disabledTools],
    toolProfiles,
    toolSettings,
    disabledFileSkills: [...sets.file],
    enabledNerveSkills: [...sets.nerve],
    enabledAgentBrowserSkills: [...sets.agentBrowser],
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function normalizeCapabilityOverrides(
  document: Document,
  inherited: CapabilitySelection,
): Document {
  const effective = resolveCapabilitySelection({
      user: inherited,
      conversation: document,
    }),
    next = empty();
  for (const name of new Set([
    ...Object.keys(document.tools),
    ...Object.keys(document.toolSettings),
  ])) {
    const enabled = !effective.disabledTools.includes(name),
      profileId = effective.toolProfiles[name],
      settings = effective.toolSettings[name];
    if (
      enabled === !inherited.disabledTools.includes(name) &&
      (!profiled.includes(name) ||
        profileId === inherited.toolProfiles[name]) &&
      (!configurable.includes(name) ||
        canonical(settings) === canonical(inherited.toolSettings[name]))
    )
      continue;
    next.tools[name] = { enabled, ...(profileId ? { profileId } : {}) };
    if (configurable.includes(name)) next.toolSettings[name] = settings;
  }
  for (const kind of kinds)
    for (const [name, enabled] of Object.entries(document.skills[kind])) {
      const parent =
        kind === "file"
          ? !inherited.disabledFileSkills.includes(name)
          : kind === "nerve"
            ? inherited.enabledNerveSkills.includes(name)
            : inherited.enabledAgentBrowserSkills.includes(name);
      if (enabled !== parent) next.skills[kind][name] = enabled;
    }
  return capabilityOverridesDocumentSchema.parse(next);
}
