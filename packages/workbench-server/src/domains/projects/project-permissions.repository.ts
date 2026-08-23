import { join } from "node:path";
import {
  type ProjectSupervisionPreferences,
  projectSupervisionPreferencesSchema,
} from "@nervekit/contracts";
import {
  atomicWriteJson,
  type InitializedStorage,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

const emptyPermissions = (): ProjectSupervisionPreferences => ({
  version: 1,
  grants: [],
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

  async get(projectId: string): Promise<ProjectSupervisionPreferences> {
    const raw = await readJsonFile<unknown>(this.file(projectId)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    return raw === undefined
      ? emptyPermissions()
      : projectSupervisionPreferencesSchema.parse(raw);
  }

  async replace(
    projectId: string,
    permissions: ProjectSupervisionPreferences,
  ): Promise<ProjectSupervisionPreferences> {
    const parsed = projectSupervisionPreferencesSchema.parse(permissions);
    await atomicWriteJson(this.file(projectId), parsed, 0o600);
    return parsed;
  }
}
