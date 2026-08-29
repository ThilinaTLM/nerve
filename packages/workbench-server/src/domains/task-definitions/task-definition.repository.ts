import { join } from "node:path";
import { projectRecordSchema } from "@nervekit/contracts/projects";
import {
  taskDefinitionFileSchema,
  taskDefinitionSchema,
  type TaskDefinition,
} from "@nervekit/contracts/task-definitions";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import {
  atomicWriteJson,
  readJsonFile,
} from "../../infrastructure/storage-bootstrap/index.js";

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
