import { join } from "node:path";
import type { Project } from "@nervekit/contracts/core";
import {
  taskDefinitionFileSchema,
  taskDefinitionSchema,
  type TaskDefinition,
} from "@nervekit/contracts/task-definitions";
import {
  atomicWriteJson,
  readJsonFile,
} from "../../infrastructure/storage-bootstrap/index.js";

export class TaskDefinitionRepository {
  constructor(private readonly getProject: (id: string) => Project) {}

  async list(projectId: string): Promise<TaskDefinition[]> {
    const path = await this.path(projectId);
    const raw = await readJsonFile<unknown>(path).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return { version: 1, definitions: [] };
        throw error;
      },
    );
    const parsed = taskDefinitionFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid project task definitions at ${path}.`, {
        cause: parsed.error,
      });
    }
    return parsed.data.definitions.map((definition) =>
      taskDefinitionSchema.parse({
        ...definition,
        scope: { kind: "project", projectId },
      }),
    );
  }

  async replace(
    projectId: string,
    definitions: TaskDefinition[],
  ): Promise<void> {
    await atomicWriteJson(
      await this.path(projectId),
      taskDefinitionFileSchema.parse({ version: 1, definitions }),
      0o600,
    );
  }

  private async path(projectId: string): Promise<string> {
    const project = this.getProject(projectId);
    return join(project.directory, ".nerve", "tasks", "definitions.json");
  }
}
