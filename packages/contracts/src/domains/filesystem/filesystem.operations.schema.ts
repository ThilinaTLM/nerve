import {
  filesystemDirectoryQuerySchema,
  filesystemDirectoryResponseSchema,
  filesystemProjectEntriesQuerySchema,
  filesystemProjectEntriesResponseSchema,
} from "./index.js";
import { defineOperation } from "../protocol/operation-definition.schema.js";

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
] as const;
