import {
  filesystemDirectoryQuerySchema,
  filesystemDirectoryResponseSchema,
  filesystemProjectEntriesQuerySchema,
  filesystemProjectEntriesResponseSchema,
  filesystemProjectEntryCreateRequestSchema,
  filesystemProjectEntryCreateResponseSchema,
} from "./index.js";
import { defineOperation } from "../../operations/definition.js";

export const filesystemOperationDefinitions = [
  defineOperation(
    "filesystem.directories.list",
    filesystemDirectoryQuerySchema.optional(),
    filesystemDirectoryResponseSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.filesystem.directories.list",
  ),
  defineOperation(
    "filesystem.project.entries.list",
    filesystemProjectEntriesQuerySchema,
    filesystemProjectEntriesResponseSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.filesystem.project.entries.list",
  ),
  defineOperation(
    "filesystem.project.entries.create",
    filesystemProjectEntryCreateRequestSchema,
    filesystemProjectEntryCreateResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.filesystem.project.entries.create",
  ),
] as const;
