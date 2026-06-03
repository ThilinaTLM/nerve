import { z } from "zod";

export const filesystemSignalSchema = z.enum([
  "git",
  "package",
  "workspace",
  "python",
  "rust",
  "go",
]);
export type FilesystemSignal = z.infer<typeof filesystemSignalSchema>;

export const filesystemEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.literal("directory"),
  hidden: z.boolean(),
  signals: z.array(filesystemSignalSchema),
});
export type FilesystemEntry = z.infer<typeof filesystemEntrySchema>;

export const filesystemDirectoryResponseSchema = z.object({
  path: z.string().min(1),
  parent: z.string().min(1).optional(),
  signals: z.array(filesystemSignalSchema),
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

export const clipboardImageUploadRequestSchema = z.object({
  name: z.string().optional(),
  type: z.string().min(1),
  dataBase64: z.string().min(1),
});
export type ClipboardImageUploadRequest = z.infer<
  typeof clipboardImageUploadRequestSchema
>;

export const clipboardImageUploadResponseSchema = z.object({
  path: z.string().min(1),
});
export type ClipboardImageUploadResponse = z.infer<
  typeof clipboardImageUploadResponseSchema
>;
