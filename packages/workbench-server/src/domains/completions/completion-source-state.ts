import type {
  CompletionSourceState,
  CompletionGroup,
} from "@nervekit/contracts/completions";

const sourceLabels: Readonly<Record<string, string>> = {
  files: "Files",
  pull_requests: "GitHub",
  issues: "Issues",
  skills: "Skills",
  tools: "Tools",
  profiles: "Agents",
  subagents: "Agents",
  launches: "Launches",
  launch_definitions: "Launches",
};

const sourceGroups: Readonly<Record<string, CompletionGroup[]>> = {
  files: ["files"],
  pull_requests: ["pull_requests"],
  issues: ["issues"],
  skills: ["skills"],
  tools: ["tools"],
  profiles: ["agents"],
  subagents: ["agents"],
  launches: ["launches"],
  launch_definitions: ["launches"],
};

/** Public source health never exposes provider exception details. */
export function completionSourceState({
  source,
  groups,
  status,
  updatedAt,
  refreshing,
  reason,
  action,
}: CompletionSourceState): CompletionSourceState {
  const label = sourceLabels[source] ?? source;
  return {
    source,
    groups: groups ?? sourceGroups[source] ?? [],
    label,
    status,
    refreshing: refreshing ?? false,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...((status === "unavailable" || status === "stale") &&
    (reason || status === "unavailable")
      ? {
          reason: reason ?? `${label} couldn’t be loaded. Try again.`,
          ...(action ? { action } : {}),
        }
      : {}),
  };
}
