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
    "providers.",
    "secrets.",
    "daemon.",
    "maintenance.",
    "activity.",
    "completion.",
    "usage.",
    "scratchNote.",
    "prompt_suggestions.",
    "agentProfiles.",
    "applicationLog.",
    "plan.written",
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
  if (method === "project.openEditor" || method === "project.openTerminal")
    return true;
  return [
    "filesystem.",
    "git.",
    "github.",
    "scratchNote.",
    "promptSuggestion.",
    "agentProfiles.",
    "projectInstructions.",
    "launch.",
    "launchDefinition.",
    "launchFolder.",
    "launchCatalog.",
    "settings.",
    "projectSettings.",
    "applicationConfiguration.",
    "auth.",
    "providerCatalog.",
    "storage.",
    "maintenance.",
    "activity.",
    "status.",
    "usage.",
    "applicationLog.",
  ].some((prefix) => method.startsWith(prefix));
}
