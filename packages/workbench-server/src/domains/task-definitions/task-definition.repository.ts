import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { taskDefinitionSchema, type TaskDefinition } from "@nervekit/contracts";
import {
  atomicWriteJson,
  type InitializedStorage,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

export class TaskDefinitionRepository {
  constructor(private readonly storage: InitializedStorage) {}

  private file(projectId: string): string {
    return join(
      this.storage.paths.home,
      "projects",
      projectId,
      "task-definitions.json",
    );
  }

  async list(projectId: string): Promise<TaskDefinition[]> {
    const raw = await readJsonFile<unknown>(this.file(projectId)).catch(
      () => undefined,
    );
    if (!Array.isArray(raw)) return [];
    return raw.map((value) => taskDefinitionSchema.parse(value));
  }

  async replace(
    projectId: string,
    definitions: TaskDefinition[],
  ): Promise<void> {
    const file = this.file(projectId);
    await mkdir(dirname(file), { recursive: true, mode: 0o755 });
    await atomicWriteJson(file, definitions, 0o600);
  }
}
