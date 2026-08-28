import type { PermissionRuleSetSummary } from "@nervekit/contracts";
import { getPermissionPolicyConfiguration } from "$lib/api";
import { BUILT_IN_PERMISSION_RULE_SET_SUMMARIES } from "$lib/kernel/permissions/permission-rule-set-options";

type CatalogEntry = {
  summaries: PermissionRuleSetSummary[];
  loading: boolean;
  loaded: boolean;
  error?: string;
};

class PermissionRuleSetCatalog {
  private entries = $state<Record<string, CatalogEntry>>({});
  private readonly inFlight = new Map<
    string,
    Promise<PermissionRuleSetSummary[]>
  >();

  summaries(projectId: string | undefined): PermissionRuleSetSummary[] {
    if (!projectId) return [...BUILT_IN_PERMISSION_RULE_SET_SUMMARIES];
    return (
      this.entries[projectId]?.summaries ?? [
        ...BUILT_IN_PERMISSION_RULE_SET_SUMMARIES,
      ]
    );
  }

  loading(projectId: string | undefined): boolean {
    return projectId ? (this.entries[projectId]?.loading ?? false) : false;
  }

  error(projectId: string | undefined): string | undefined {
    return projectId ? this.entries[projectId]?.error : undefined;
  }

  install(projectId: string, summaries: readonly PermissionRuleSetSummary[]) {
    this.entries[projectId] = {
      summaries: [...summaries],
      loading: false,
      loaded: true,
    };
  }

  ensure(projectId: string): Promise<PermissionRuleSetSummary[]> {
    if (this.entries[projectId]?.loaded) {
      return Promise.resolve(this.entries[projectId].summaries);
    }
    return this.load(projectId);
  }

  refresh(projectId: string): Promise<PermissionRuleSetSummary[]> {
    return this.load(projectId);
  }

  private load(projectId: string): Promise<PermissionRuleSetSummary[]> {
    const existing = this.inFlight.get(projectId);
    if (existing) return existing;

    const current = this.entries[projectId];
    this.entries[projectId] = {
      summaries: current?.summaries ?? [
        ...BUILT_IN_PERMISSION_RULE_SET_SUMMARIES,
      ],
      loading: true,
      loaded: current?.loaded ?? false,
      error: undefined,
    };

    const request = getPermissionPolicyConfiguration(projectId)
      .then((configuration) => {
        this.install(projectId, configuration.ruleSets);
        return [...configuration.ruleSets];
      })
      .catch((error: unknown) => {
        const entry = this.entries[projectId];
        this.entries[projectId] = {
          summaries: entry?.summaries ?? [
            ...BUILT_IN_PERMISSION_RULE_SET_SUMMARIES,
          ],
          loading: false,
          loaded: entry?.loaded ?? false,
          error:
            error instanceof Error && error.message.trim()
              ? error.message
              : "Could not load permission rule sets.",
        };
        return this.entries[projectId].summaries;
      })
      .finally(() => {
        if (this.inFlight.get(projectId) === request) {
          this.inFlight.delete(projectId);
        }
      });
    this.inFlight.set(projectId, request);
    return request;
  }
}

export const permissionRuleSetCatalog = new PermissionRuleSetCatalog();
