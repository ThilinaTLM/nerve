import type { AvailableSkill } from "@nervekit/contracts/skills";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

/**
 * What the open project brings that user settings pages point at ("In this
 * project"): its skills and installed extensions. Read on demand, in memory.
 */
class ProjectGuidesState {
  projectId = $state<string>();
  skills = $state<readonly AvailableSkill[]>([]);
  projectExtensions = $state(0);
  #request = 0;

  async load(projectId: string | undefined): Promise<void> {
    const request = ++this.#request;
    if (!projectId) {
      this.projectId = undefined;
      this.skills = [];
      this.projectExtensions = 0;
      return;
    }
    const [skills, extensions] = await Promise.all([
      requestConversation("skill.list", { projectId })
        .then((result) => result.skills)
        .catch(() => []),
      requestWorkbench("extensions.get", {
        target: { scope: "project", projectId },
      })
        .then(
          (view) =>
            view.catalog.filter((entry) => entry.source === "project").length,
        )
        .catch(() => 0),
    ]);
    if (request !== this.#request) return;
    this.projectId = projectId;
    this.skills = skills;
    this.projectExtensions = extensions;
  }
}

export const projectGuidesState = new ProjectGuidesState();
