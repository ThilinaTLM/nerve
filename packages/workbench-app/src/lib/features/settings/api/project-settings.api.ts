import type {
  ProjectSettingsPatch,
  ProjectSettingsResult,
} from "@nervekit/contracts/settings";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

export function readProjectSettings(
  projectId: string,
): Promise<ProjectSettingsResult> {
  return requestWorkbench("projectSettings.get", { projectId });
}

export function updateProjectSettings(
  projectId: string,
  patch: ProjectSettingsPatch,
): Promise<ProjectSettingsResult> {
  return requestWorkbench("projectSettings.update", { projectId, patch });
}
