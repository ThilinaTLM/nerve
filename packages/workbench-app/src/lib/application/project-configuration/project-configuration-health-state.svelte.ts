import {
  projectConfigurationHealthSchema,
  type ProjectConfigurationHealth,
  type ProjectConfigurationIssue,
  type ResolveProjectConfiguration,
} from "@nervekit/contracts/projects";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import { withHealth } from "./project-configuration-health";

type IssueRef = Pick<ProjectConfigurationIssue, "projectId" | "type">;

/** Shared by the activity list, the launches notice, the toast and the reset confirmation. */
class ProjectConfigurationHealthController {
  byProject = $state<Record<string, readonly ProjectConfigurationIssue[]>>({});
  pending = $state(false);
  error = $state<string>();
  /** The file awaiting reset confirmation. */
  resetTarget = $state<ProjectConfigurationIssue>();
  private readonly listeners = new Set<
    (health: ProjectConfigurationHealth) => void
  >();

  issuesFor(
    projectId: string | undefined,
  ): readonly ProjectConfigurationIssue[] {
    return projectId ? (this.byProject[projectId] ?? []) : [];
  }

  /** Applies the full health of one project (operation result or event). */
  apply(health: ProjectConfigurationHealth): void {
    this.byProject = withHealth(this.byProject, health);
    for (const listener of this.listeners) listener(health);
  }

  /** Lets owners of derived data (e.g. the launch catalog) reload after a change. */
  onApplied(
    listener: (health: ProjectConfigurationHealth) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  async refresh(projectId: string): Promise<void> {
    try {
      this.apply(
        projectConfigurationHealthSchema.parse(
          await requestWorkbench("project.configuration.health", { projectId }),
        ),
      );
    } catch (error) {
      this.error = message(
        error,
        "Could not load project configuration health.",
      );
    }
  }

  async reload(issue: IssueRef): Promise<void> {
    await this.resolve({ ...issue, action: "reload" });
  }

  async reset(issue: ProjectConfigurationIssue): Promise<void> {
    await this.resolve(
      issue.classification === "legacy"
        ? {
            projectId: issue.projectId,
            type: "legacy-files",
            action: "remove-legacy",
            confirmed: true,
          }
        : {
            projectId: issue.projectId,
            type: issue.type,
            action: "reset",
            confirmed: true,
          },
    );
  }

  /** Reset is never direct: it opens the confirmation owned by the watcher. */
  requestReset(issue: ProjectConfigurationIssue): void {
    this.resetTarget = issue;
  }

  private folderOpener?: (issue: ProjectConfigurationIssue) => Promise<void>;
  registerFolderOpener(
    open: (issue: ProjectConfigurationIssue) => Promise<void>,
  ): () => void {
    this.folderOpener = open;
    return () => {
      this.folderOpener = undefined;
    };
  }
  async open(issue: ProjectConfigurationIssue): Promise<void> {
    try {
      if (issue.classification === "legacy") {
        if (!this.folderOpener)
          throw new Error("Folder navigation is unavailable");
        await this.folderOpener(issue);
      } else
        await openFilePane({ projectId: issue.projectId, path: issue.path });
    } catch (error) {
      this.error = message(error, "Could not open project settings.");
    }
  }

  private async resolve(
    request: ResolveProjectConfiguration & { projectId: string },
  ): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.error = undefined;
    try {
      this.apply(
        projectConfigurationHealthSchema.parse(
          await requestWorkbench("project.configuration.resolve", request),
        ),
      );
    } catch (error) {
      this.error = message(error, "Could not update project configuration.");
    } finally {
      this.pending = false;
    }
  }
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const projectConfigurationHealth =
  new ProjectConfigurationHealthController();
