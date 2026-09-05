import type {
  PermissionOverlay,
  PermissionOverlayDocument,
  PermissionPolicyConfiguration,
  PermissionRule,
  ProjectRecord,
} from "$lib/api";

export type PermissionScope = "project" | "user";

type Dependencies = {
  getConfiguration(projectId: string): Promise<PermissionPolicyConfiguration>;
  updateOverlay(
    projectId: string,
    scope: PermissionScope,
    overlay: PermissionOverlay,
  ): Promise<PermissionOverlay>;
  updateTrust(projectId: string, trusted: boolean): Promise<void>;
  onConfigurationLoaded?(
    projectId: string,
    configuration: PermissionPolicyConfiguration,
  ): void;
};

export class PermissionsPageState {
  project = $state<ProjectRecord>();
  configuration = $state<PermissionPolicyConfiguration>();
  loading = $state(false);
  errorMessage = $state<string>();
  pendingKeys = $state<string[]>([]);
  overlayRuleSetId = $state("supervised");
  private generation = 0;

  constructor(private readonly dependencies: Dependencies) {}

  selectProject(project: ProjectRecord | undefined): void {
    if (this.project?.id === project?.id) return;
    this.project = project;
    this.configuration = undefined;
    this.errorMessage = undefined;
    const generation = ++this.generation;
    if (project) void this.load(project.id, generation);
  }

  retry(): void {
    if (!this.project) return;
    void this.load(this.project.id, ++this.generation);
  }

  refresh(): void {
    this.retry();
  }

  selectRuleSet(ruleSetId: string): void {
    this.overlayRuleSetId = ruleSetId;
    this.errorMessage = undefined;
  }

  rules(scope: PermissionScope): PermissionRule[] {
    if (!this.configuration) return [];
    const document =
      scope === "project"
        ? this.configuration.projectOverlays
        : this.configuration.userOverlays;
    return (
      document.overlays.find(
        (overlay) => overlay.ruleSetId === this.overlayRuleSetId,
      )?.rules ?? []
    );
  }

  isPending(scope: PermissionScope, id: string): boolean {
    return this.pendingKeys.includes(`${scope}:${this.overlayRuleSetId}:${id}`);
  }

  async remove(scope: PermissionScope, id: string): Promise<void> {
    await this.save(
      scope,
      this.rules(scope).filter((rule) => rule.id !== id),
      `${scope}:${this.overlayRuleSetId}:${id}`,
    );
  }

  async add(scope: PermissionScope, input: PermissionRule): Promise<boolean> {
    const current = this.rules(scope);
    if (
      current.some(
        (candidate) =>
          candidate.enforcement === input.enforcement &&
          JSON.stringify(candidate.when) === JSON.stringify(input.when),
      )
    ) {
      this.errorMessage = "An identical matcher already exists in this scope.";
      return false;
    }
    const priorities = current
      .filter((rule) => rule.enforcement === input.enforcement)
      .map((rule) => rule.priority);
    const priority = Math.min(1_000, Math.max(-1, ...priorities) + 1);
    return this.save(
      scope,
      [...current, { ...input, priority }],
      `${scope}:${this.overlayRuleSetId}:${input.id}`,
    );
  }

  async update(
    scope: PermissionScope,
    originalId: string,
    replacement: PermissionRule,
  ): Promise<boolean> {
    const current = this.rules(scope);
    const index = current.findIndex((rule) => rule.id === originalId);
    if (index === -1) {
      this.errorMessage = "The permission rule no longer exists.";
      return false;
    }
    if (
      current.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index &&
          candidate.enforcement === replacement.enforcement &&
          JSON.stringify(candidate.when) === JSON.stringify(replacement.when),
      )
    ) {
      this.errorMessage = "An identical matcher already exists in this scope.";
      return false;
    }
    const rules = [...current];
    rules[index] = replacement;
    return this.save(
      scope,
      rules,
      `${scope}:${this.overlayRuleSetId}:${originalId}`,
    );
  }

  async setTrusted(trusted: boolean): Promise<void> {
    if (!this.project) return;
    const key = `project:${this.overlayRuleSetId}:trust`;
    if (this.pendingKeys.includes(key)) return;
    this.pendingKeys = [...this.pendingKeys, key];
    this.errorMessage = undefined;
    try {
      await this.dependencies.updateTrust(this.project.id, trusted);
      await this.load(this.project.id, ++this.generation);
    } catch (error) {
      this.errorMessage = errorMessage(
        error,
        "Could not update project trust.",
      );
    } finally {
      this.pendingKeys = this.pendingKeys.filter((item) => item !== key);
    }
  }

  private async save(
    scope: PermissionScope,
    rules: PermissionRule[],
    key: string,
  ): Promise<boolean> {
    if (!this.project || this.pendingKeys.includes(key)) return false;
    this.pendingKeys = [...this.pendingKeys, key];
    this.errorMessage = undefined;
    try {
      const overlay = await this.dependencies.updateOverlay(
        this.project.id,
        scope,
        { ruleSetId: this.overlayRuleSetId, rules },
      );
      if (!this.configuration) return true;
      this.configuration = {
        ...this.configuration,
        ...(scope === "project"
          ? {
              projectOverlays: replaceOverlay(
                this.configuration.projectOverlays,
                overlay,
              ),
            }
          : {
              userOverlays: replaceOverlay(
                this.configuration.userOverlays,
                overlay,
              ),
            }),
      };
      if (scope === "project")
        await this.load(this.project.id, ++this.generation);
      return true;
    } catch (error) {
      this.errorMessage = errorMessage(
        error,
        "Could not save permission rules.",
      );
      return false;
    } finally {
      this.pendingKeys = this.pendingKeys.filter((item) => item !== key);
    }
  }

  private async load(projectId: string, generation: number): Promise<void> {
    this.loading = true;
    try {
      const configuration = await this.dependencies.getConfiguration(projectId);
      if (generation !== this.generation || this.project?.id !== projectId)
        return;
      this.configuration = configuration;
      this.dependencies.onConfigurationLoaded?.(projectId, configuration);
      this.errorMessage = undefined;
    } catch (error) {
      if (generation !== this.generation || this.project?.id !== projectId)
        return;
      this.errorMessage = errorMessage(
        error,
        "Could not load permission policy configuration.",
      );
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
}

function replaceOverlay(
  document: PermissionOverlayDocument,
  overlay: PermissionOverlay,
): PermissionOverlayDocument {
  const overlays = document.overlays.filter(
    (candidate) => candidate.ruleSetId !== overlay.ruleSetId,
  );
  if (overlay.rules.length > 0) overlays.push(overlay);
  overlays.sort((left, right) => left.ruleSetId.localeCompare(right.ruleSetId));
  return { schemaVersion: 2, overlays };
}

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error.message.trim() || fallback;
}
