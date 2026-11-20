import type {
  LaunchesAgentPort,
  LaunchEntryDefinition,
  LaunchEntryFolder,
  LaunchPlacement,
} from "@nervekit/tools/quick-script";
import {
  createLaunchDefinitionRequestSchema,
  updateLaunchDefinitionRequestSchema,
  type LaunchCatalogEntryRef,
  type LaunchDefinition,
  type LaunchFolder,
} from "@nervekit/contracts/launch-definitions";
import { ApplicationError } from "../../core/application-error.js";
import type { LaunchDefinitionService } from "../../domains/launch-definitions/launch-definition.service.js";

const HINTS: Record<string, string> = {
  LAUNCH_CATALOG_ENTRY_NOT_FOUND:
    "No definition or folder has this id. Call launches.list() for the ids.",
  LAUNCH_FOLDER_NOT_FOUND:
    "No folder has this id. Call launches.list() for the ids, or create it with launches.folders.create().",
  LAUNCH_FOLDER_NAME_CONFLICT: "Pick another folder name.",
  LAUNCH_FOLDER_INVALID_NAME: "Give the folder a name.",
  LAUNCH_CATALOG_INVALID_MOVE: "Move it into a folder that is not inside it.",
  LAUNCH_CATALOG_INVALID_ANCHOR:
    "`before` must be a sibling in the destination `folder`; check launches.list().",
  LAUNCH_CATALOG_CONFLICT: "The catalog changed meanwhile. Call it again.",
  LAUNCH_CATALOG_BUSY: "Another change is in progress. Call it again.",
};

function reword(error: unknown): never {
  if (error instanceof ApplicationError)
    throw new Error(`${error.message} ${HINTS[error.code] ?? ""}`.trim());
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (
      error as { issues: { path: PropertyKey[]; message: string }[] }
    ).issues;
    throw new Error(
      `Invalid launch definition: ${issues
        .map(
          (issue) =>
            `${issue.path.map(String).join(".") || "input"}: ${issue.message}`,
        )
        .join("; ")}.`,
    );
  }
  throw error;
}

function reference(id: string, name = "id"): LaunchCatalogEntryRef {
  if (id.startsWith("launchdef_")) return { kind: "definition", id };
  if (id.startsWith("launchfolder_")) return { kind: "folder", id };
  throw new Error(
    `${name} "${id}" is not a launch id; ids start with launchdef_ or launchfolder_. Call launches.list().`,
  );
}

const asDefinition = (definition: LaunchDefinition): LaunchEntryDefinition => ({
  id: definition.id,
  ...(definition.label !== undefined ? { label: definition.label } : {}),
  command: definition.command,
  ...(definition.cwd !== undefined ? { cwd: definition.cwd } : {}),
  ...(definition.port !== undefined ? { port: definition.port } : {}),
  runPolicy: definition.runPolicy,
  folder: definition.parentFolderId,
  order: definition.order,
});

const asFolder = (folder: LaunchFolder): LaunchEntryFolder => ({
  id: folder.id,
  label: folder.label,
  folder: folder.parentFolderId,
  order: folder.order,
});

const destination = (placement: LaunchPlacement) => ({
  parentFolderId: placement.folder ?? null,
  beforeSibling: placement.before
    ? reference(placement.before, "before")
    : null,
});

/**
 * The `launches.*` quick_script namespace for one project: the app's own `LaunchDefinitionService`
 * does the writing (lock, ids, timestamps, order), so the agent never edits `definitions.json`.
 * Inputs are checked against the contract schemas and failures say what to fix.
 */
export function createLaunchesAgentPort(options: {
  definitions: Pick<
    LaunchDefinitionService,
    | "catalog"
    | "problem"
    | "create"
    | "update"
    | "remove"
    | "createFolder"
    | "move"
  >;
  projectId: string;
}): LaunchesAgentPort {
  const { definitions, projectId } = options;

  /** An invalid file reads as an empty catalog: refuse instead of writing over it. */
  async function revision(): Promise<string> {
    const problem = await definitions.problem(projectId);
    if (problem)
      throw new Error(
        `${problem.path} is invalid (${problem.reason}), so the project has no launch definitions and changes are refused. Fix the file (JSON Schema in the configure-nerve skill), then check it with configuration.check("project").`,
      );
    return (await definitions.catalog(projectId)).revision;
  }

  async function write<T>(
    action: (revision: string) => Promise<T>,
  ): Promise<T> {
    try {
      return await action(await revision());
    } catch (error) {
      return reword(error);
    }
  }

  return {
    async list() {
      await revision();
      const catalog = await definitions.catalog(projectId);
      return {
        definitions: catalog.definitions.map(asDefinition),
        folders: catalog.folders.map(asFolder),
      };
    },
    create: (input) =>
      write(async (expected) => {
        const request = createLaunchDefinitionRequestSchema.parse({
          label: input.label ?? undefined,
          command: input.command,
          cwd: input.cwd ?? undefined,
          port: input.port ?? undefined,
          runPolicy: input.runPolicy,
          ...destination(input),
        });
        return asDefinition(
          (await definitions.create(projectId, request, expected)).definition,
        );
      }),
    update: (id, input) =>
      write(async (expected) => {
        reference(id);
        const current = (await definitions.catalog(projectId)).definitions.find(
          (definition) => definition.id === id,
        );
        if (!current)
          throw new ApplicationError(
            404,
            "LAUNCH_CATALOG_ENTRY_NOT_FOUND",
            `Launch definition "${id}" not found.`,
          );
        const pick = <T>(next: T | null | undefined, previous: T | undefined) =>
          next === undefined ? previous : (next ?? undefined);
        const request = updateLaunchDefinitionRequestSchema.parse({
          label: pick(input.label, current.label),
          command: input.command ?? current.command,
          cwd: pick(input.cwd, current.cwd),
          port: pick(input.port, current.port),
          runPolicy: input.runPolicy ?? current.runPolicy,
        });
        return asDefinition(
          (await definitions.update(projectId, id, request, expected))
            .definition,
        );
      }),
    remove: (id) =>
      write(async (expected) => {
        if (reference(id).kind !== "definition")
          throw new Error(
            `"${id}" is a folder; launches.remove deletes definitions. Move its entries out and ask the user to delete the folder.`,
          );
        await definitions.remove(projectId, id, expected);
        return { ok: true as const };
      }),
    createFolder: (input) =>
      write(async (expected) =>
        asFolder(
          (
            await definitions.createFolder(
              projectId,
              { label: input.label, ...destination(input) },
              expected,
            )
          ).folder,
        ),
      ),
    move: (id, placement) =>
      write(async (expected) => {
        await definitions.move(
          projectId,
          {
            entry: reference(id),
            destinationFolderId: placement.folder ?? null,
            beforeSibling: destination(placement).beforeSibling,
          },
          expected,
        );
        return { ok: true as const };
      }),
  };
}
