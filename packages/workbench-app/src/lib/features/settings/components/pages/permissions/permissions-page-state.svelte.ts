import type {
  PermissionException,
  ProjectPermissions,
  ProjectRecord,
  ToolDescriptor,
} from "$lib/api";

export type PermissionScope = "project" | "user";

type Dependencies = {
  getProject(projectId: string): Promise<ProjectPermissions>;
  updateProject(
    projectId: string,
    permissions: ProjectPermissions,
  ): Promise<ProjectPermissions>;
  updateUser(exceptions: PermissionException[]): Promise<void>;
  listTools(): Promise<ToolDescriptor[]>;
};

export class PermissionsPageState {
  project = $state<ProjectRecord>();
  projectPermissions = $state<ProjectPermissions>();
  tools = $state<ToolDescriptor[]>([]);
  projectLoading = $state(false);
  toolsLoading = $state(false);
  projectError = $state<string>();
  userError = $state<string>();
  toolsError = $state<string>();
  pendingKeys = $state<string[]>([]);
  private generation = 0;

  constructor(private readonly dependencies: Dependencies) {
    void this.loadTools();
  }

  selectProject(project: ProjectRecord | undefined): void {
    if (this.project?.id === project?.id) return;
    this.project = project;
    this.projectPermissions = undefined;
    this.projectError = undefined;
    this.generation += 1;
    if (project) void this.loadProject(project.id, this.generation);
  }

  retryProject(): void {
    if (!this.project) return;
    const generation = ++this.generation;
    void this.loadProject(this.project.id, generation);
  }

  retryTools(): void {
    void this.loadTools();
  }

  error(scope: PermissionScope): string | undefined {
    return scope === "project" ? this.projectError : this.userError;
  }

  isPending(scope: PermissionScope, id: string): boolean {
    return this.pendingKeys.includes(`${scope}:${id}`);
  }

  async remove(
    scope: PermissionScope,
    id: string,
    userExceptions: PermissionException[],
  ): Promise<void> {
    const key = `${scope}:${id}`;
    if (this.pendingKeys.includes(key)) return;
    this.pendingKeys = [...this.pendingKeys, key];
    this.setError(scope, undefined);
    try {
      const current = this.exceptions(scope, userExceptions);
      await this.save(
        scope,
        current.filter((exception) => exception.id !== id),
      );
    } catch (error) {
      this.setError(
        scope,
        errorMessage(error, "Could not remove the exception."),
      );
    } finally {
      this.pendingKeys = this.pendingKeys.filter(
        (candidate) => candidate !== key,
      );
    }
  }

  async add(
    scope: PermissionScope,
    exception: PermissionException,
    userExceptions: PermissionException[],
  ): Promise<boolean> {
    const current = this.exceptions(scope, userExceptions);
    if (
      current.some(
        (candidate) =>
          candidate.tool === exception.tool &&
          candidate.effect === exception.effect &&
          candidate.rule === exception.rule,
      )
    ) {
      this.setError(scope, "This exception already exists in this scope.");
      return false;
    }
    const key = `${scope}:${exception.id}`;
    this.pendingKeys = [...this.pendingKeys, key];
    this.setError(scope, undefined);
    try {
      await this.save(scope, [...current, exception]);
      return true;
    } catch (error) {
      this.setError(
        scope,
        errorMessage(error, "Could not save the exception."),
      );
      return false;
    } finally {
      this.pendingKeys = this.pendingKeys.filter(
        (candidate) => candidate !== key,
      );
    }
  }

  private exceptions(
    scope: PermissionScope,
    userExceptions: PermissionException[],
  ): PermissionException[] {
    return scope === "project"
      ? (this.projectPermissions?.exceptions ?? [])
      : userExceptions;
  }

  private async save(
    scope: PermissionScope,
    exceptions: PermissionException[],
  ): Promise<void> {
    if (scope === "user") {
      await this.dependencies.updateUser(exceptions);
      return;
    }
    if (!this.project) throw new Error("Select a project first.");
    const saved = await this.dependencies.updateProject(this.project.id, {
      version: 2,
      exceptions,
    });
    this.projectPermissions = saved;
  }

  private setError(scope: PermissionScope, value: string | undefined): void {
    if (scope === "project") this.projectError = value;
    else this.userError = value;
  }

  private async loadTools(): Promise<void> {
    this.toolsLoading = true;
    try {
      this.tools = await this.dependencies.listTools();
      this.toolsError = undefined;
    } catch (error) {
      this.toolsError = errorMessage(error, "Could not load tools.");
    } finally {
      this.toolsLoading = false;
    }
  }

  private async loadProject(
    projectId: string,
    generation: number,
  ): Promise<void> {
    this.projectLoading = true;
    try {
      const permissions = await this.dependencies.getProject(projectId);
      if (generation !== this.generation || this.project?.id !== projectId)
        return;
      this.projectPermissions = permissions;
      this.projectError = undefined;
    } catch (error) {
      if (generation !== this.generation || this.project?.id !== projectId)
        return;
      this.projectError = errorMessage(
        error,
        "Could not load project exceptions.",
      );
    } finally {
      if (generation === this.generation) this.projectLoading = false;
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
