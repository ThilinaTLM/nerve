import type { Project } from "@nervekit/contracts/core";
import type { CreateTaskDefinitionRequest } from "@nervekit/contracts/task-definitions";
import type { TaskPortConflictListener } from "@nervekit/contracts/tasks";
import type { LaunchService } from "../tasks/application/launch.service.js";
import { resolveTaskWorkingDirectory } from "../tasks/model/task-working-directory.js";
import type { TaskDefinitionService } from "./task-definition.service.js";

export class TaskDefinitionOperations {
  constructor(
    private readonly definitions: TaskDefinitionService,
    private readonly launches: LaunchService,
    private readonly listProjects: () => Project[],
  ) {}

  async create(projectId: string, request: CreateTaskDefinitionRequest) {
    if (request.sourceTaskId) {
      const source = await this.launches.require(request.sourceTaskId);
      if (source.projectId !== projectId)
        throw new Error("Source task does not belong to this project.");
    }
    const definition = await this.definitions.create(projectId, request);
    if (!request.sourceTaskId) return definition;
    try {
      await this.launches.associateDefinition(
        request.sourceTaskId,
        definition.id,
      );
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
      return this.launches.launchDefinition({
        definitionId: definition.id,
        definitionRunPolicy: definition.runPolicy,
        definitionPort: definition.port,
        terminateListeners,
        projectId: project.id,
        cwd: resolveTaskWorkingDirectory(
          definition.cwd ?? project.directory,
          project.directory,
        ),
        command: definition.command,
        displayName: definition.label ?? definition.command,
        origin: { kind: "utility_panel" },
      });
    }
    throw new Error("Task definition not found.");
  }
}
