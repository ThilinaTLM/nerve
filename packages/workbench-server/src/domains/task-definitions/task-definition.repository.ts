import { taskDefinitionSchema, type TaskDefinition } from "@nervekit/contracts";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";

export class TaskDefinitionRepository {
  constructor(private readonly storage: InitializedStorage) {}

  async list(projectId: string): Promise<TaskDefinition[]> {
    const document = await this.storage.canonicalStore.readDocument<unknown>(
      "task_definitions",
      projectId,
      "definitions",
    );
    if (!Array.isArray(document?.data)) return [];
    return document.data.map((definition) =>
      taskDefinitionSchema.parse(definition),
    );
  }

  async replace(
    projectId: string,
    definitions: TaskDefinition[],
  ): Promise<void> {
    const parsed = definitions.map((definition) =>
      taskDefinitionSchema.parse(definition),
    );
    const current = await this.storage.canonicalStore.readDocument(
      "task_definitions",
      projectId,
      "definitions",
    );
    await this.storage.canonicalStore.writeDocument({
      namespace: "task_definitions",
      scopeId: projectId,
      documentId: "definitions",
      data: parsed,
      expectedRevision: current?.revision ?? 0,
    });
  }
}
