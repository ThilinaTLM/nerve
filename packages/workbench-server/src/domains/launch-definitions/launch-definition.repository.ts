import { join } from "node:path";
import type { Project } from "@nervekit/contracts/core";
import {
  launchDefinitionFileSchema,
  launchDefinitionSchema,
  type LaunchDefinition,
} from "@nervekit/contracts/launch-definitions";
import {
  atomicWriteJson,
  readJsonFile,
} from "../../infrastructure/storage-bootstrap/index.js";

export class LaunchDefinitionRepository {
  constructor(private readonly getProject: (id: string) => Project) {}

  async list(projectId: string): Promise<LaunchDefinition[]> {
    const path = await this.path(projectId);
    const raw = await readJsonFile<unknown>(path).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return { version: 1, definitions: [] };
        throw error;
      },
    );
    const parsed = launchDefinitionFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid project launch definitions at ${path}.`, {
        cause: parsed.error,
      });
    }
    return parsed.data.definitions.map((definition) =>
      launchDefinitionSchema.parse({
        ...definition,
        scope: { kind: "project", projectId },
      }),
    );
  }

  async replace(
    projectId: string,
    definitions: LaunchDefinition[],
  ): Promise<void> {
    await atomicWriteJson(
      await this.path(projectId),
      launchDefinitionFileSchema.parse({ version: 1, definitions }),
      0o600,
    );
  }

  private async path(projectId: string): Promise<string> {
    const project = this.getProject(projectId);
    return join(project.directory, ".nerve", "launches", "definitions.json");
  }
}
