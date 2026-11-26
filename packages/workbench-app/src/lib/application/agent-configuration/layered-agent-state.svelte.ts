import type { ResolutionOptions } from "@nervekit/contracts/agent-configuration";
import type { Layer } from "@nervekit/contracts/core";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { isProjectLocked } from "./project-lock";
import { ScopedAgentState } from "./scoped-agent-state.svelte";

/**
 * The user and project agent settings a layered settings page edits side by
 * side. `context` names the open project; `layered` (default: a project is
 * open) says whether the project column is shown.
 */
export class LayeredAgentState {
  readonly user: ScopedAgentState;
  readonly project: ScopedAgentState;

  constructor(
    private readonly context: () => { projectId?: string; layered?: boolean },
    clampThinking?: ResolutionOptions["clampThinking"],
  ) {
    this.user = new ScopedAgentState(clampThinking);
    this.project = new ScopedAgentState(clampThinking);
  }

  /** A project column is shown next to User. */
  get layered(): boolean {
    const { projectId, layered } = this.context();
    return layered ?? !!projectId;
  }

  editor(layer: Layer): ScopedAgentState {
    return layer === "project" ? this.project : this.user;
  }

  get ready(): boolean {
    return (
      !!this.user.resolution && (!this.layered || !!this.project.resolution)
    );
  }

  get error(): string | undefined {
    return this.user.error ?? (this.layered ? this.project.error : undefined);
  }

  /** The project's settings file is not trusted: its column is locked. */
  get locked(): boolean {
    return this.layered && isProjectLocked(this.project.document);
  }

  /**
   * Loads both layers once the startup phase allows it and follows their
   * changes. Call during component initialisation. Whatever `reloadOn` reads
   * (e.g. the model list `clampThinking` uses) reloads both layers.
   */
  connect(reloadOn?: () => unknown): void {
    $effect(() => {
      if (!workbenchStartupState.progressiveActive) return;
      reloadOn?.();
      void this.user.load({ scope: "user" });
    });
    $effect(() => {
      const { projectId } = this.context();
      if (!workbenchStartupState.progressiveActive || !projectId) return;
      reloadOn?.();
      void this.project.load({ scope: "project", projectId });
    });
    $effect(() => this.user.observe());
    $effect(() => this.project.observe());
  }

  /** Republishes both files from disk and reloads them. */
  reload(): Promise<unknown> {
    return Promise.all([
      this.user.reload(),
      this.layered ? this.project.reload() : undefined,
    ]);
  }
}
