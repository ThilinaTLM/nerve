import { join } from "node:path";
import { type ProjectRecord, projectRecordSchema } from "@nervekit/contracts";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";

export class ProjectRepository {
  constructor(private readonly storage: InitializedStorage) {}

  projectDir(projectId: string): string {
    return join(this.storage.paths.home, "projects", projectId);
  }

  /** Retained only as a path helper for user-authored project sidecars. */
  projectPath(projectId: string): string {
    return join(this.projectDir(projectId), "project.json");
  }

  async loadAll(): Promise<ProjectRecord[]> {
    return (
      await this.storage.canonicalStore.listDocuments<unknown>(
        "project",
        "global",
      )
    ).map((document) => projectRecordSchema.parse(document.data));
  }

  async write(project: ProjectRecord): Promise<void> {
    const parsed = projectRecordSchema.parse(project);
    const current = await this.storage.canonicalStore.readDocument(
      "project",
      "global",
      parsed.id,
    );
    await this.storage.canonicalStore.writeDocument({
      namespace: "project",
      scopeId: "global",
      documentId: parsed.id,
      data: parsed,
      expectedRevision: current?.revision ?? 0,
      now: parsed.updatedAt,
    });
  }

  async remove(projectId: string): Promise<void> {
    await this.storage.canonicalStore.deleteDocument(
      "project",
      "global",
      projectId,
    );
  }
}
