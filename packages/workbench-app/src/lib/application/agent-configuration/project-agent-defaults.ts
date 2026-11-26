import type { ProjectAgentDefaultsResult } from "@nervekit/contracts/agent-configuration";
import { KeyedLoader } from "../refresh/keyed-loader";
/** A synchronized client read model, not a settings authority. All resolution,
 * caching of dependencies and persistence belong to the backend service. */
export class ProjectAgentDefaultsReadModel {
  private readonly loader: KeyedLoader<string, ProjectAgentDefaultsResult>;

  constructor(
    request: (projectId: string) => Promise<ProjectAgentDefaultsResult>,
  ) {
    this.loader = new KeyedLoader({
      load: request,
      // A failed read shows nothing rather than stale defaults; the next load retries.
      onError: (projectId) => this.loader.delete(projectId),
    });
  }

  get(projectId: string | undefined): ProjectAgentDefaultsResult | undefined {
    return projectId ? this.loader.get(projectId) : undefined;
  }

  async load(projectId: string, refresh = false): Promise<void> {
    await (refresh
      ? this.loader.refresh(projectId)
      : this.loader.ensure(projectId));
  }

  async refresh(projectId?: string): Promise<void> {
    await Promise.all(
      this.loader
        .keys()
        .filter((id) => !projectId || id === projectId)
        .map((id) => this.loader.refresh(id)),
    );
  }
}
