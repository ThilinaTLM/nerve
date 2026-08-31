import type { ProjectRecord } from "@nervekit/contracts/projects";
import type { CreateTaskDefinitionRequest } from "@nervekit/contracts/task-definitions";
import type { TaskPortConflictListener } from "@nervekit/contracts/tasks";
import type { WorkbenchTaskService } from "../tasks/adapters/workbench-task-service.js";
import type { TaskDefinitionService } from "./task-definition.service.js";

export class TaskDefinitionOperations {
  constructor(
    private readonly definitions: TaskDefinitionService,
    private readonly tasks: WorkbenchTaskService,
    private readonly listProjects: () => ProjectRecord[],
  ) {}

  async create(projectId: string, request: CreateTaskDefinitionRequest) {
    if (request.sourceTaskId) {
      const source = this.tasks.getTask(request.sourceTaskId);
      if (source.projectId !== projectId)
        throw new Error("Source task does not belong to this project.");
    }
    const definition = await this.definitions.create(projectId, request);
    if (!request.sourceTaskId) return definition;
    try {
      await this.tasks.associateDefinition(request.sourceTaskId, definition.id);
      return definition;
    } catch (error) {
      await this.definitions
        .remove(projectId, definition.id)
        .catch(() => undefined);
      throw error;
    }
  }

  async launch(
    definitionId: string,
    terminateListeners?: TaskPortConflictListener[],
  ) {
    for (const project of this.listProjects()) {
      const definition = (await this.definitions.list(project.id)).find(
        (item) => item.id === definitionId,
      );
      if (!definition) continue;
      return this.tasks.launchDefinition({
        definitionId: definition.id,
        definitionRunPolicy: definition.runPolicy,
        definitionPort: definition.port,
        terminateListeners,
        projectId: project.id,
        cwd: definition.cwd ?? project.dir,
        command: definition.command,
        displayName: definition.label ?? definition.command,
        origin: { kind: "utility_panel" },
      });
    }
    throw new Error("Task definition not found.");
  }
}
