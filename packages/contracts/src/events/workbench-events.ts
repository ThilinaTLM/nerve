/** Workbench notices are snapshots/invalidation hints, never durable history. */
export function isWorkbenchEvent(type: string): boolean {
  return [
    "filesystem.",
    "git.",
    "github.",
    "launch.",
    "launchCatalog.",
    "settings.",
    "projectSettings.",
    "applicationConfiguration.",
    "auth.",
    "accounts.",
    "extensions.",
    "mcp.",
    "access.",
    "providers.",
    "secrets.",
    "daemon.",
    "maintenance.",
    "activity.",
    "backgroundJobs.",
    "completion.",
    "usage.",
    "scratchNote.",
    "prompt_suggestions.",
    "agentProfiles.",
    "applicationLog.",
    "plan.written",
    "project.configuration.health",
  ].some((prefix) => type.startsWith(prefix));
}

/** Operations owned by the IDE surface rather than conversation execution. */
export function isWorkbenchOperation(method: string): boolean {
  if (
    [
      "agentConfiguration.reload",
      "agentConfiguration.trust",
      "agentConfiguration.repairPreview",
      "agentConfiguration.repairApply",
    ].includes(method)
  )
    return true;
  if (method === "completion.search" || method === "completion.select")
    return true;
  if (
    [
      "project.openEditor",
      "project.openTerminal",
      "project.configuration.health",
      "project.configuration.resolve",
    ].includes(method)
  )
    return true;
  return [
    "filesystem.",
    "git.",
    "github.",
    "scratchNote.",
    "promptSuggestion.",
    "agentProfiles.",
    "extensions.",
    "mcp.",
    "launch.",
    "launchDefinition.",
    "launchFolder.",
    "launchCatalog.",
    "settings.",
    "conversationTitles.",
    "projectSettings.",
    "applicationConfiguration.",
    "auth.",
    "accounts.",
    "providerCatalog.",
    "storage.",
    "maintenance.",
    "activity.",
    "backgroundJobs.",
    "status.",
    "usage.",
    "applicationLog.",
    "access.",
  ].some((prefix) => method.startsWith(prefix));
}
