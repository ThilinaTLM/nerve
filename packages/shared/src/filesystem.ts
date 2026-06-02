import { z } from "zod";

export const filesystemEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.literal("directory"),
  hidden: z.boolean(),
});
export type FilesystemEntry = z.infer<typeof filesystemEntrySchema>;

export const filesystemDirectoryResponseSchema = z.object({
  path: z.string().min(1),
  parent: z.string().min(1).optional(),
  entries: z.array(filesystemEntrySchema),
});
export type FilesystemDirectoryResponse = z.infer<
  typeof filesystemDirectoryResponseSchema
>;

export const filesystemDirectoryQuerySchema = z.object({
  path: z.string().optional(),
  showHidden: z.coerce.boolean().optional(),
});
export type FilesystemDirectoryQuery = z.infer<
  typeof filesystemDirectoryQuerySchema
>;
