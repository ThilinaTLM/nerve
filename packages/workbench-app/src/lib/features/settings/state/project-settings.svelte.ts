import type {
  ProjectSettingsPatch,
  ProjectSettingsResult,
} from "@nervekit/contracts/settings";
import {
  readProjectSettings,
  updateProjectSettings,
} from "../api/project-settings.api";

/** Page-local state: responses from a previous project must never replace the active one. */
export class ProjectSettingsState {
  projectId = $state<string>();
  result = $state.raw<ProjectSettingsResult>();
  loading = $state(false);
  saving = $state(false);
  error = $state<string>();
  private request = 0;
  private saveRequest = 0;

  async load(projectId: string | undefined): Promise<void> {
    const request = ++this.request;
    if (this.projectId !== projectId) {
      this.projectId = projectId;
      this.result = undefined;
      this.saving = false;
      ++this.saveRequest;
    }
    this.error = undefined;
    this.loading = !!projectId;
    if (!projectId) return;
    try {
      const result = await readProjectSettings(projectId);
      if (request === this.request) this.result = result;
    } catch (error) {
      if (request === this.request)
        this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (request === this.request) this.loading = false;
    }
  }

  async update(patch: ProjectSettingsPatch): Promise<void> {
    const projectId = this.projectId;
    if (!projectId || this.saving) return;
    const request = ++this.request;
    const saveRequest = ++this.saveRequest;
    this.saving = true;
    this.error = undefined;
    try {
      const result = await updateProjectSettings(projectId, patch);
      if (request === this.request) this.result = result;
    } catch (error) {
      if (request === this.request)
        this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (saveRequest === this.saveRequest) this.saving = false;
    }
  }
}
