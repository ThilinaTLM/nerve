import { SvelteMap } from "svelte/reactivity";
import type { ProjectAgentDefaultsResult } from "@nervekit/contracts/agent-configuration";
/** A synchronized client read model, not a settings authority. All resolution,
 * caching of dependencies and persistence belong to the backend service. */
export class ProjectAgentDefaultsReadModel {
  private readonly results = new SvelteMap<
    string,
    ProjectAgentDefaultsResult
  >();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly request: (
      projectId: string,
    ) => Promise<ProjectAgentDefaultsResult>,
  ) {}

  get(projectId: string | undefined): ProjectAgentDefaultsResult | undefined {
    return projectId ? this.results.get(projectId) : undefined;
  }

  load(projectId: string, refresh = false): Promise<void> {
    if (!refresh) {
      const loading = this.pending.get(projectId);
      if (loading) return loading;
      if (this.results.has(projectId)) return Promise.resolve();
    }
    const generation = (this.generations.get(projectId) ?? 0) + 1;
    this.generations.set(projectId, generation);
    const loading = this.request(projectId)
      .then((result) => {
        if (this.generations.get(projectId) === generation)
          this.results.set(projectId, result);
      })
      .catch(() => {
        if (this.generations.get(projectId) === generation)
          this.results.delete(projectId);
      })
      .finally(() => {
        if (this.pending.get(projectId) === loading)
          this.pending.delete(projectId);
      });
    this.pending.set(projectId, loading);
    return loading;
  }

  async refresh(projectId?: string): Promise<void> {
    await Promise.all(
      [...this.generations.keys()]
        .filter((id) => !projectId || id === projectId)
        .map((id) => this.load(id, true)),
    );
  }
}
