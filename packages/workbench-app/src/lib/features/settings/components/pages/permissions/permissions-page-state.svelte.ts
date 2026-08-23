import type {
  PermissionException,
  ProjectPermissions,
  ProjectRecord,
} from "$lib/api";

export type PermissionScope = "project" | "global";

type Dependencies = {
  getProject(projectId: string): Promise<ProjectPermissions>;
  updateProject(
    projectId: string,
    permissions: ProjectPermissions,
  ): Promise<ProjectPermissions>;
  updateGlobal(exceptions: PermissionException[]): Promise<void>;
};

export class PermissionsPageState {
  scope = $state<PermissionScope>("global");
  project = $state<ProjectRecord>();
  projectPermissions = $state<ProjectPermissions>();
  loading = $state(false);
  error = $state<string>();
  pendingIds = $state<string[]>([]);
  private generation = 0;

  constructor(private readonly dependencies: Dependencies) {}

  selectProject(project: ProjectRecord | undefined): void {
    if (this.project?.id === project?.id) return;
    this.project = project;
    this.scope = project ? "project" : "global";
    this.projectPermissions = undefined;
    this.error = undefined;
    this.generation += 1;
    if (project) void this.loadProject(project.id, this.generation);
  }

  retry(): void {
    if (!this.project) return;
    const generation = ++this.generation;
    void this.loadProject(this.project.id, generation);
  }

  exceptions(globalExceptions: PermissionException[]): PermissionException[] {
    return this.scope === "project"
      ? (this.projectPermissions?.exceptions ?? [])
      : globalExceptions;
  }

  async save(exceptions: PermissionException[]): Promise<void> {
    this.error = undefined;
    if (this.scope === "global") {
      await this.dependencies.updateGlobal(exceptions);
      return;
    }
    if (!this.project) return;
    const saved = await this.dependencies.updateProject(this.project.id, {
      version: 1,
      exceptions,
    });
    this.projectPermissions = saved;
  }

  async remove(
    id: string,
    globalExceptions: PermissionException[],
  ): Promise<void> {
    if (this.pendingIds.includes(id)) return;
    this.pendingIds = [...this.pendingIds, id];
    try {
      const next = this.exceptions(globalExceptions).filter(
        (exception) => exception.id !== id,
      );
      await this.save(next);
    } catch (error) {
      this.error = errorMessage(error, "Could not remove the exception.");
    } finally {
      this.pendingIds = this.pendingIds.filter((candidate) => candidate !== id);
    }
  }

  async add(
    exception: PermissionException,
    globalExceptions: PermissionException[],
  ): Promise<boolean> {
    const current = this.exceptions(globalExceptions);
    if (
      current.some(
        (candidate) =>
          candidate.effect === exception.effect &&
          (candidate.effect !== "allow" ||
            (exception.effect === "allow" &&
              candidate.risk === exception.risk)) &&
          JSON.stringify(candidate.selector) ===
            JSON.stringify(exception.selector),
      )
    ) {
      this.error = "This exception already exists in the selected scope.";
      return false;
    }
    this.pendingIds = [...this.pendingIds, exception.id];
    try {
      await this.save([...current, exception]);
      return true;
    } catch (error) {
      this.error = errorMessage(error, "Could not save the exception.");
      return false;
    } finally {
      this.pendingIds = this.pendingIds.filter(
        (candidate) => candidate !== exception.id,
      );
    }
  }

  private async loadProject(
    projectId: string,
    generation: number,
  ): Promise<void> {
    this.loading = true;
    try {
      const permissions = await this.dependencies.getProject(projectId);
      if (generation !== this.generation || this.project?.id !== projectId)
        return;
      this.projectPermissions = permissions;
      this.error = undefined;
    } catch (error) {
      if (generation !== this.generation || this.project?.id !== projectId)
        return;
      this.error = errorMessage(error, "Could not load project exceptions.");
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  return message && !message.startsWith("[") && !message.startsWith("{")
    ? message
    : fallback;
}
