import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import {
  createLaunchDefinitionRequestSchema,
  launchDefinitionSchema,
  updateLaunchDefinitionRequestSchema,
  launchDefinitionCatalogSchema,
  launchFolderSchema,
  launchCatalogEntryRefSchema,
} from "./launch-definition.js";
const project = z.object({ projectId: z.string().startsWith("proj_") });
const mutation = project.extend({ expectedRevision: z.string() });
const revision = { revision: z.string() };
const folderId = z.string().startsWith("launchfolder_");
const destination = {
  parentFolderId: folderId.nullable().default(null),
  beforeSibling: launchCatalogEntryRefSchema.nullable().default(null),
};
const hostRoles = ["workbench_server"] as const;
export const launchDefinitionOperationDefinitions = [
  defineOperation(
    "launchDefinition.list",
    project,
    z.object({ catalog: launchDefinitionCatalogSchema }),
    "read",
    "none",
    hostRoles,
    "operation.launchDefinition.list",
  ),
  defineOperation(
    "launchDefinition.create",
    mutation.merge(createLaunchDefinitionRequestSchema),
    z.object({ definition: launchDefinitionSchema, ...revision }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.launchDefinition.create",
  ),
  defineOperation(
    "launchDefinition.update",
    mutation
      .extend({ definitionId: z.string().startsWith("launchdef_") })
      .merge(updateLaunchDefinitionRequestSchema),
    z.object({ definition: launchDefinitionSchema, ...revision }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.launchDefinition.update",
  ),
  defineOperation(
    "launchDefinition.delete",
    mutation.extend({ definitionId: z.string().startsWith("launchdef_") }),
    z.object({ ok: z.literal(true), ...revision }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.launchDefinition.delete",
  ),
  defineOperation(
    "launchFolder.create",
    mutation.extend({ label: z.string().trim().min(1), ...destination }),
    z.object({ folder: launchFolderSchema, ...revision }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.launchFolder.create",
  ),
  defineOperation(
    "launchFolder.rename",
    mutation.extend({ folderId, label: z.string().trim().min(1) }),
    z.object({ folder: launchFolderSchema, ...revision }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.launchFolder.rename",
  ),
  defineOperation(
    "launchFolder.delete",
    mutation.extend({ folderId }),
    z.object({ ok: z.literal(true), ...revision }),
    "mutation",
    "recommended",
    hostRoles,
    "operation.launchFolder.delete",
  ),
  defineOperation(
    "launchCatalog.move",
    mutation.extend({
      entry: launchCatalogEntryRefSchema,
      destinationFolderId: folderId.nullable(),
      beforeSibling: launchCatalogEntryRefSchema.nullable(),
    }),
    z.object(revision),
    "mutation",
    "recommended",
    hostRoles,
    "operation.launchCatalog.move",
  ),
] as const;
