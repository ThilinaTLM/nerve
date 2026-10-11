import type { Project } from "@nervekit/contracts/core";
import type { CreateLaunchDefinitionRequest } from "@nervekit/contracts/launch-definitions";
import type { LaunchPortConflictListener } from "@nervekit/contracts/launches";
import type { LaunchService } from "../launches/application/launch.service.js";
import { resolveLaunchWorkingDirectory } from "../launches/model/launch-working-directory.js";
import type { LaunchDefinitionService } from "./launch-definition.service.js";

export class LaunchDefinitionOperations {
  constructor(
    private readonly definitions: LaunchDefinitionService,
    private readonly launches: LaunchService,
    private readonly listProjects: () => Project[],
  ) {}

  async create(projectId: string, request: CreateLaunchDefinitionRequest) {
    if (request.sourceLaunchId) {
      const source = await this.launches.require(request.sourceLaunchId);
      if (source.projectId !== projectId)
        throw new Error("Source launch does not belong to this project.");
    }
    const definition = await this.definitions.create(projectId, request);
    if (!request.sourceLaunchId) return definition;
    try {
      await this.launches.associateDefinition(
        request.sourceLaunchId,
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
    terminateListeners?: LaunchPortConflictListener[],
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
        cwd: resolveLaunchWorkingDirectory(
          definition.cwd ?? project.directory,
          project.directory,
        ),
        command: definition.command,
        displayName: definition.label ?? definition.command,
      });
    }
    throw new Error("Launch definition not found.");
  }
}
