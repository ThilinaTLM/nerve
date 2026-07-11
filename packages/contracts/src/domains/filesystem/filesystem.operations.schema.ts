import {
  filesystemDirectoryQuerySchema,
  filesystemDirectoryResponseSchema,
} from "./index.js";
import { defineOperation } from "../protocol/operation-definition.schema.js";

export const filesystemOperationDefinitions = [
  defineOperation(
    "filesystem.directories.list",
    filesystemDirectoryQuerySchema.optional(),
    filesystemDirectoryResponseSchema,
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.filesystem.directories.list",
  ),
] as const;
