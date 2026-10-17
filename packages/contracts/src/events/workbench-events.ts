/** Workbench notices are snapshots/invalidation hints, never durable history. */
export function isWorkbenchEvent(type: string): boolean {
  return [
    "filesystem.",
    "git.",
    "github.",
    "launch.",
    "launchCatalog.",
    "settings.",
    "applicationConfiguration.",
    "auth.",
    "providers.",
    "secrets.",
    "daemon.",
    "maintenance.",
    "activity.",
    "usage.",
    "scratchNote.",
    "prompt_suggestions.",
    "subagentProfiles.",
    "applicationLog.",
    "plan.written",
  ].some((prefix) => type.startsWith(prefix));
}

/** Operations owned by the IDE surface rather than conversation execution. */
export function isWorkbenchOperation(method: string): boolean {
  if (method === "project.openEditor" || method === "project.openTerminal")
    return true;
  return [
    "filesystem.",
    "git.",
    "github.",
    "scratchNote.",
    "promptSuggestion.",
    "subagentProfiles.",
    "launch.",
    "launchDefinition.",
    "launchFolder.",
    "launchCatalog.",
    "settings.",
    "applicationConfiguration.",
    "auth.",
    "providerCatalog.",
    "storage.",
    "maintenance.",
    "activity.",
    "status.",
    "usage.",
    "applicationLog.",
    "completion.files.",
  ].some((prefix) => method.startsWith(prefix));
}
