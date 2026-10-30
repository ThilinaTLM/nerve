import type { AgentConfigurationService } from "../agent-configuration-service.js";
/** Explicit health recovery republishes already loaded feature generations. */
export function registerProjectRecovery(
  service: AgentConfigurationService,
): void {
  service.projectMigration.onResolved(async (context, type) => {
    const scope = { scope: "project" as const, projectId: context.projectId };
    if (
      ["agent-settings", "capabilities", "integrations", "subagents"].includes(
        type.id,
      )
    )
      await service.reload(scope);
    if (type.id === "conversation-defaults")
      await service.reloadCreation(scope);
    if (type.id.startsWith("agent-profile:"))
      await service.profiles.reload(
        scope,
        type.id.slice("agent-profile:".length),
      );
    if (type.id === "subagents") await service.profiles.reloadCatalog(scope);
  });
}
