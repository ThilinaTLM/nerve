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
  async create(
    projectId: string,
    request: CreateLaunchDefinitionRequest,
    expectedRevision: string,
  ) {
    if (request.sourceLaunchId) {
      const source = await this.launches.require(request.sourceLaunchId);
      if (source.projectId !== projectId)
        throw new Error("Source launch does not belong to this project.");
    }
    const result = await this.definitions.create(
      projectId,
      request,
      expectedRevision,
    );
    if (!request.sourceLaunchId) return result;
    try {
      await this.launches.associateDefinition(
        request.sourceLaunchId,
        result.definition.id,
      );
      return result;
    } catch (error) {
      // Compensation must not undo somebody else's committed catalog changes.
      await this.definitions
        .remove(projectId, result.definition.id, result.revision)
        .catch((compensationError) => {
          console.error(
            "Could not compensate launch definition association failure",
            {
              projectId,
              definitionId: result.definition.id,
              compensationError,
            },
          );
        });
      throw error;
    }
  }
  async launch(
    projectId: string,
    definitionId: string,
    terminateListeners?: LaunchPortConflictListener[],
  ) {
    const project = this.listProjects().find((p) => p.id === projectId);
    if (!project) throw new Error("Project not found.");
    const definition = await this.definitions.get(projectId, definitionId);
    return this.launches.launchDefinition({
      definitionId: definition.id,
      definitionRunPolicy: definition.runPolicy,
      definitionPort: definition.port,
      terminateListeners,
      projectId,
      cwd: resolveLaunchWorkingDirectory(
        definition.cwd ?? project.directory,
        project.directory,
      ),
      command: definition.command,
      displayName: definition.label ?? definition.command,
    });
  }
}
