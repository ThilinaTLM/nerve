import { join } from "node:path";
import {
  projectRecordSchema,
  taskDefinitionSchema,
  type TaskDefinition,
} from "@nervekit/contracts";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import {
  atomicWriteJson,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

export class TaskDefinitionRepository {
  constructor(private readonly storage: InitializedStorage) {}

  async list(projectId: string): Promise<TaskDefinition[]> {
    const path = await this.path(projectId);
    const raw = await readJsonFile<unknown>(path).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return { version: 1, definitions: [] };
        throw error;
      },
    );
    const record = raw as { version?: unknown; definitions?: unknown };
    if (record.version !== 1 || !Array.isArray(record.definitions)) {
      throw new Error(`Invalid project task definitions at ${path}.`);
    }
    return record.definitions.map((definition) =>
      taskDefinitionSchema.parse(definition),
    );
  }

  async replace(
    projectId: string,
    definitions: TaskDefinition[],
  ): Promise<void> {
    await atomicWriteJson(
      await this.path(projectId),
      {
        version: 1,
        definitions: definitions.map((definition) =>
          taskDefinitionSchema.parse(definition),
        ),
      },
      0o600,
    );
  }

  private async path(projectId: string): Promise<string> {
    const document = await this.storage.canonicalStore.readDocument<unknown>(
      "project",
      "global",
      projectId,
    );
    if (!document) throw new Error("Project not found.");
    const project = projectRecordSchema.parse(document.data);
    return join(project.dir, ".nerve", "tasks", "definitions.json");
  }
}
