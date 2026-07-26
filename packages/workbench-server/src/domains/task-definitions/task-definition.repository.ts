import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  pinnedCommandSchema,
  taskDefinitionSchema,
  type TaskDefinition,
} from "@nervekit/contracts";
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

  private legacyFile(projectId: string): string {
    return join(
      this.storage.paths.home,
      "projects",
      projectId,
      "pinned-commands.json",
    );
  }

  async list(projectId: string): Promise<TaskDefinition[]> {
    const raw = await readJsonFile<unknown>(this.file(projectId)).catch(
      () => undefined,
    );
    if (Array.isArray(raw))
      return raw.flatMap((value) => {
        const result = taskDefinitionSchema.safeParse(value);
        return result.success ? [result.data] : [];
      });
    const legacy = await readJsonFile<unknown>(
      this.legacyFile(projectId),
    ).catch(() => undefined);
    if (!Array.isArray(legacy)) return [];
    const migrated = legacy.flatMap((value) => {
      const result = pinnedCommandSchema.safeParse(value);
      if (!result.success) return [];
      return [
        taskDefinitionSchema.parse({
          id: result.data.id.replace(/^pin_/, "taskdef_"),
          scope: { kind: "project", projectId },
          label: result.data.label,
          command: result.data.command,
          cwd: result.data.cwd,
          runPolicy: "single",
          createdAt: result.data.createdAt,
          updatedAt: result.data.updatedAt,
        }),
      ];
    });
    await this.replace(projectId, migrated);
    await rm(this.legacyFile(projectId), { force: true });
    return migrated;
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
