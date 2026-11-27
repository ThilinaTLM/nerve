import type { PermissionRuleSetSummary } from "@nervekit/contracts/permissions";
import { KeyedLoader } from "$lib/application/refresh/keyed-loader";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import { BUILT_IN_PERMISSION_RULE_SET_SUMMARIES } from "$lib/domain/permissions/rule-set-options";

class PermissionRuleSetCatalog {
  private errors = $state<Record<string, string>>({});
  // A failed read keeps the last summaries (built-ins before the first load) and reports why.
  private readonly loader = new KeyedLoader<string, PermissionRuleSetSummary[]>(
    {
      load: () =>
        requestConversation("permissionRuleSet.list", {}).then(
          (configuration) =>
            configuration.ruleSets.map(
              ({ id, name, source, enabled, description }) => ({
                id,
                name,
                source,
                enabled,
                description,
                available: enabled,
              }),
            ),
        ),
      onError: (projectId, error) => {
        this.errors[projectId] =
          error instanceof Error && error.message.trim()
            ? error.message
            : "Could not load permission rule sets.";
      },
    },
  );

  summaries(projectId: string | undefined): PermissionRuleSetSummary[] {
    return (
      (projectId ? this.loader.get(projectId) : undefined) ?? [
        ...BUILT_IN_PERMISSION_RULE_SET_SUMMARIES,
      ]
    );
  }

  loading(projectId: string | undefined): boolean {
    return projectId ? this.loader.loading(projectId) : false;
  }

  error(projectId: string | undefined): string | undefined {
    return projectId ? this.errors[projectId] : undefined;
  }

  install(projectId: string, summaries: readonly PermissionRuleSetSummary[]) {
    delete this.errors[projectId];
    this.loader.set(projectId, [...summaries]);
  }

  async ensure(projectId: string): Promise<PermissionRuleSetSummary[]> {
    if (!this.loader.has(projectId)) delete this.errors[projectId];
    await this.loader.ensure(projectId);
    return this.summaries(projectId);
  }

  async refresh(projectId: string): Promise<PermissionRuleSetSummary[]> {
    delete this.errors[projectId];
    await this.loader.refresh(projectId);
    return this.summaries(projectId);
  }
}

export const permissionRuleSetCatalog = new PermissionRuleSetCatalog();
