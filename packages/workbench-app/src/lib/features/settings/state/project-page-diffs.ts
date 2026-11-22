import type { ExtensionsView } from "@nervekit/contracts/extensions";
import type { PromptSuggestionStatus } from "@nervekit/contracts/prompt-suggestions";
import {
  canonicalSettingsEntries,
  type LeadSettingsOverrides,
} from "@nervekit/contracts/agent-configuration";

/** Pages whose project overrides live in the project's `agent.json`. */
export type AgentOverridePageId = "general" | "tools" | "skills" | "sub-agents";

const prefixByPage: Record<Exclude<AgentOverridePageId, "general">, string> = {
  tools: "/tools",
  skills: "/skills",
  "sub-agents": "/subagents",
};

function belongsTo(pageId: AgentOverridePageId, pointer: string): boolean {
  if (pageId !== "general")
    return pointer.startsWith(`${prefixByPage[pageId]}/`);
  // General owns everything the other pages do not.
  return !Object.values(prefixByPage).some((prefix) =>
    pointer.startsWith(`${prefix}/`),
  );
}

/** The project's own agent settings that sit on one page (JSON pointers below `/overrides`). */
export function agentOverridePointers(
  overrides: LeadSettingsOverrides,
  pageId: AgentOverridePageId,
): string[] {
  return canonicalSettingsEntries(overrides)
    .map(([pointer]) => pointer)
    .filter((pointer) => belongsTo(pageId, pointer));
}

/** Pointers in the form `agentConfiguration.save` takes as `resets`. */
export function agentOverrideResets(
  overrides: LeadSettingsOverrides,
  pageId: AgentOverridePageId,
): string[] {
  return agentOverridePointers(overrides, pageId).map(
    (pointer) => `/overrides${pointer}`,
  );
}

/** Sums the counts of the sources that feed one page, dropping empty pages. */
export function mergeDiffCounts(
  ...sources: Readonly<Record<string, number>>[]
): Record<string, number> {
  const total: Record<string, number> = {};
  for (const source of sources)
    for (const [page, count] of Object.entries(source))
      if (count > 0) total[page] = (total[page] ?? 0) + count;
  return total;
}

const sameValue = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

/** Extensions whose project entry changes what User's settings give (a stored entry equal to User's is no difference). */
export function differingExtensionCount(
  project: ExtensionsView | undefined,
  user: ExtensionsView | undefined,
): number {
  if (!project || !user) return 0;
  const inherited = new Map(
    user.extensions.map((entry) => [entry.metadata.id, entry]),
  );
  return project.extensions.filter((entry) => {
    const stored = entry.stored;
    const base = inherited.get(entry.metadata.id);
    if (!stored || !base) return false;
    if (stored.enabled !== undefined && stored.enabled !== base.enabled.value)
      return true;
    return Object.entries(stored.settings).some(
      ([key, value]) => !sameValue(value, base.fields[key]?.value),
    );
  }).length;
}

/** Suggestions the project switches differently from User's effective value. */
export function differingSuggestionCount(
  statuses: readonly Pick<
    PromptSuggestionStatus,
    "projectEnabled" | "userEnabled" | "defaultEnabled"
  >[],
): number {
  return statuses.filter(
    (status) =>
      status.projectEnabled !== undefined &&
      status.projectEnabled !== (status.userEnabled ?? status.defaultEnabled),
  ).length;
}
