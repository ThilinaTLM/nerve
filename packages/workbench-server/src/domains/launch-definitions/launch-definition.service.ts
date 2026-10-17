import {
  type CreateLaunchDefinitionRequest,
  type LaunchDefinition,
  type UpdateLaunchDefinitionRequest,
  type LaunchDefinitionFile,
  type LaunchCatalogEntryRef,
} from "@nervekit/contracts/launch-definitions";
import { createId } from "@nervekit/contracts";
import { type Project } from "@nervekit/contracts/core";
import { ApplicationError } from "../../core/application-error.js";
import type { LaunchDefinitionRepository } from "./launch-definition.repository.js";

type Entry =
  | LaunchDefinitionFile["definitions"][number]
  | LaunchDefinitionFile["folders"][number];
function entries(file: LaunchDefinitionFile): Entry[] {
  return [...file.folders, ...file.definitions];
}
function find(file: LaunchDefinitionFile, ref: LaunchCatalogEntryRef): Entry {
  const entry = (ref.kind === "folder" ? file.folders : file.definitions).find(
    (e) => e.id === ref.id,
  );
  if (!entry)
    throw new ApplicationError(
      404,
      "LAUNCH_CATALOG_ENTRY_NOT_FOUND",
      "Launch catalog entry not found.",
    );
  return entry;
}
function normalize(file: LaunchDefinitionFile, parent: string | null) {
  entries(file)
    .filter((e) => e.parentFolderId === parent)
    .sort((a, b) => a.order - b.order)
    .forEach((e, i) => {
      e.order = i;
    });
}
function assertFolderName(
  file: LaunchDefinitionFile,
  id: string,
  label: string,
  parent: string | null,
) {
  if (!label.trim())
    throw new ApplicationError(
      400,
      "LAUNCH_FOLDER_INVALID_NAME",
      "Folder name must be nonblank.",
    );
  if (
    file.folders.some(
      (f) =>
        f.id !== id &&
        f.parentFolderId === parent &&
        f.label.trim().toLowerCase() === label.trim().toLowerCase(),
    )
  ) {
    throw new ApplicationError(
      409,
      "LAUNCH_FOLDER_NAME_CONFLICT",
      "A folder with this name already exists at the destination.",
    );
  }
}
function place(
  file: LaunchDefinitionFile,
  entry: Entry,
  parent: string | null,
  before: LaunchCatalogEntryRef | null,
) {
  if (file.folders.some((f) => f.id === entry.id))
    assertFolderName(file, entry.id, entry.label!, parent);
  if (parent !== null && !file.folders.some((f) => f.id === parent))
    throw new ApplicationError(
      404,
      "LAUNCH_FOLDER_NOT_FOUND",
      "Destination folder not found.",
    );
  if (file.folders.some((f) => f.id === entry.id)) {
    let ancestor = parent;
    while (ancestor !== null) {
      if (ancestor === entry.id)
        throw new ApplicationError(
          400,
          "LAUNCH_CATALOG_INVALID_MOVE",
          "Cannot move a folder into itself or a descendant (folder cycle).",
        );
      ancestor = file.folders.find((f) => f.id === ancestor)!.parentFolderId;
    }
  }
  const oldParent = entry.parentFolderId;
  let anchor: Entry | undefined;
  if (before) {
    anchor = find(file, before);
    if (anchor.id === entry.id || anchor.parentFolderId !== parent)
      throw new ApplicationError(
        400,
        "LAUNCH_CATALOG_INVALID_ANCHOR",
        "Invalid insertion anchor.",
      );
  }
  const siblings = entries(file)
    .filter((e) => e.id !== entry.id && e.parentFolderId === parent)
    .sort((a, b) => a.order - b.order);
  siblings.splice(
    anchor ? siblings.findIndex((e) => e.id === anchor.id) : siblings.length,
    0,
    entry,
  );
  entry.parentFolderId = parent;
  siblings.forEach((e, i) => {
    e.order = i;
  });
  if (oldParent !== parent) normalize(file, oldParent);
}
export class LaunchDefinitionService {
  constructor(
    private readonly repository: LaunchDefinitionRepository,
    private readonly getProject: (projectId: string) => Project,
    private readonly publish?: (
      type: string,
      data: Record<string, unknown>,
    ) => Promise<void>,
  ) {}
  async catalog(projectId: string) {
    this.getProject(projectId);
    return this.repository.catalog(projectId);
  }
  async list(projectId: string): Promise<LaunchDefinition[]> {
    return (await this.catalog(projectId)).definitions;
  }
  async get(
    projectId: string,
    definitionId: string,
  ): Promise<LaunchDefinition> {
    const definition = (await this.list(projectId)).find(
      (item) => item.id === definitionId,
    );
    if (!definition)
      throw new ApplicationError(
        404,
        "TASK_DEFINITION_NOT_FOUND",
        "Launch definition not found.",
      );
    return definition;
  }
  private async mutate<T>(
    projectId: string,
    revision: string,
    action: (file: LaunchDefinitionFile) => T,
  ) {
    this.getProject(projectId);
    const committed = await this.repository.transact(
      projectId,
      revision,
      action,
    );
    if (committed.changed) {
      try {
        await this.publish?.("launchCatalog.changed", {
          projectId,
          revision: committed.revision,
        });
      } catch (error) {
        console.error(
          "Committed launch catalog notification failed; retrying once",
          { projectId, revision: committed.revision, error },
        );
        try {
          await this.publish?.("launchCatalog.changed", {
            projectId,
            revision: committed.revision,
          });
        } catch (retryError) {
          console.error(
            "Committed launch catalog notification retry failed; clients recover on revalidation",
            { projectId, revision: committed.revision, error: retryError },
          );
        }
      }
    }
    return { value: committed.result, revision: committed.revision };
  }
  async create(
    projectId: string,
    request: CreateLaunchDefinitionRequest,
    expectedRevision: string,
  ) {
    const result = await this.mutate(projectId, expectedRevision, (file) => {
      const now = new Date().toISOString();
      const definition = {
        id: createId("launchdef"),
        scope: { kind: "project" as const },
        label: request.label,
        command: request.command,
        cwd: request.cwd,
        port: request.port,
        runPolicy: request.runPolicy,
        createdAt: now,
        updatedAt: now,
        parentFolderId: null,
        order: 0,
      } as LaunchDefinitionFile["definitions"][number];
      file.definitions.push(definition);
      place(file, definition, request.parentFolderId, request.beforeSibling);
      return { ...definition, scope: { kind: "project" as const, projectId } };
    });
    return { definition: result.value, revision: result.revision };
  }
  async update(
    projectId: string,
    definitionId: string,
    request: UpdateLaunchDefinitionRequest,
    expectedRevision: string,
  ) {
    const result = await this.mutate(projectId, expectedRevision, (file) => {
      const current = find(file, {
        kind: "definition",
        id: definitionId,
      }) as LaunchDefinitionFile["definitions"][number];
      const config = {
        label: request.label,
        command: request.command,
        cwd: request.cwd,
        port: request.port,
        runPolicy: request.runPolicy,
      };
      if (
        Object.entries(config).some(
          ([key, value]) => current[key as keyof typeof current] !== value,
        )
      )
        Object.assign(current, config, { updatedAt: new Date().toISOString() });
      return { ...current, scope: { kind: "project" as const, projectId } };
    });
    return { definition: result.value, revision: result.revision };
  }
  async remove(
    projectId: string,
    definitionId: string,
    expectedRevision: string,
  ) {
    const result = await this.mutate(projectId, expectedRevision, (file) => {
      const current = find(file, { kind: "definition", id: definitionId });
      file.definitions = file.definitions.filter((d) => d.id !== definitionId);
      normalize(file, current.parentFolderId);
    });
    return { ok: true as const, revision: result.revision };
  }
  async createFolder(
    projectId: string,
    request: {
      label: string;
      parentFolderId: string | null;
      beforeSibling: LaunchCatalogEntryRef | null;
    },
    expectedRevision: string,
  ) {
    const result = await this.mutate(projectId, expectedRevision, (file) => {
      const folder = {
        id: createId("launchfolder"),
        label: request.label.trim(),
        parentFolderId: null as string | null,
        order: 0,
      };
      file.folders.push(folder);
      place(file, folder, request.parentFolderId, request.beforeSibling);
      return folder;
    });
    return { folder: result.value, revision: result.revision };
  }
  async renameFolder(
    projectId: string,
    folderId: string,
    label: string,
    expectedRevision: string,
  ) {
    const result = await this.mutate(projectId, expectedRevision, (file) => {
      const folder = file.folders.find((f) => f.id === folderId);
      if (!folder)
        throw new ApplicationError(
          404,
          "LAUNCH_FOLDER_NOT_FOUND",
          "Folder not found.",
        );
      assertFolderName(file, folder.id, label, folder.parentFolderId);
      folder.label = label.trim();
      return folder;
    });
    return { folder: result.value, revision: result.revision };
  }
  async deleteFolder(
    projectId: string,
    folderId: string,
    expectedRevision: string,
  ) {
    const result = await this.mutate(projectId, expectedRevision, (file) => {
      const folder = find(file, { kind: "folder", id: folderId });
      if (entries(file).some((e) => e.parentFolderId === folderId))
        throw new ApplicationError(
          409,
          "LAUNCH_FOLDER_NOT_EMPTY",
          "Folder is not empty.",
        );
      file.folders = file.folders.filter((f) => f.id !== folderId);
      normalize(file, folder.parentFolderId);
    });
    return { ok: true as const, revision: result.revision };
  }
  async move(
    projectId: string,
    request: {
      entry: LaunchCatalogEntryRef;
      destinationFolderId: string | null;
      beforeSibling: LaunchCatalogEntryRef | null;
    },
    expectedRevision: string,
  ) {
    const result = await this.mutate(projectId, expectedRevision, (file) => {
      place(
        file,
        find(file, request.entry),
        request.destinationFolderId,
        request.beforeSibling,
      );
    });
    return { revision: result.revision };
  }
}
