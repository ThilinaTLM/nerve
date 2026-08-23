import { join } from "node:path";
import {
  type ProjectPermissions,
  projectPermissionsSchema,
} from "@nervekit/contracts";
import {
  atomicWriteJson,
  type InitializedStorage,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

const emptyPermissions = (): ProjectPermissions => ({
  version: 2,
  exceptions: [],
});

export class ProjectPermissionsRepository {
  constructor(private readonly storage: InitializedStorage) {}

  file(projectId: string): string {
    if (!/^proj_[A-Za-z0-9_-]+$/.test(projectId)) {
      throw new Error("Invalid project ID.");
    }
    return join(
      this.storage.paths.home,
      "projects",
      projectId,
      "permissions.json",
    );
  }

  async get(projectId: string): Promise<ProjectPermissions> {
    const raw = await readJsonFile<unknown>(this.file(projectId)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    return raw === undefined
      ? emptyPermissions()
      : projectPermissionsSchema.parse(raw);
  }

  async replace(
    projectId: string,
    permissions: ProjectPermissions,
  ): Promise<ProjectPermissions> {
    const parsed = projectPermissionsSchema.parse(permissions);
    await atomicWriteJson(this.file(projectId), parsed, 0o600);
    return parsed;
  }
}
