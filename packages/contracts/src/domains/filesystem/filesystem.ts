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

export const filesystemProjectEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(["file", "directory", "other"]),
  symlink: z.boolean(),
});
export type FilesystemProjectEntry = z.infer<
  typeof filesystemProjectEntrySchema
>;

export const filesystemProjectEntriesQuerySchema = z.object({
  projectId: z.string().min(1),
  path: z.string().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(2_000).optional(),
});
export type FilesystemProjectEntriesQuery = z.infer<
  typeof filesystemProjectEntriesQuerySchema
>;

export const filesystemProjectEntriesResponseSchema = z.object({
  projectId: z.string().min(1),
  path: z.string(),
  entries: z.array(filesystemProjectEntrySchema),
  nextCursor: z.string().min(1).optional(),
});
export type FilesystemProjectEntriesResponse = z.infer<
  typeof filesystemProjectEntriesResponseSchema
>;

export const filesystemProjectMonitorSyncRequestSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  directories: z.array(z.string().max(4_096)).max(512),
});
export type FilesystemProjectMonitorSyncRequest = z.infer<
  typeof filesystemProjectMonitorSyncRequestSchema
>;

export const filesystemProjectMonitorStateSchema = z.object({
  active: z.boolean(),
  degraded: z.boolean(),
  watchedDirectoryCount: z.number().int().nonnegative(),
});
export type FilesystemProjectMonitorState = z.infer<
  typeof filesystemProjectMonitorStateSchema
>;

export const filesystemProjectMonitorClearRequestSchema = z.object({
  projectId: z.string().startsWith("proj_"),
});

export const filesystemProjectRefreshRequestSchema = z.object({
  projectId: z.string().startsWith("proj_"),
});

export const monitorRefreshResponseSchema = z.object({
  /** False when no live client is monitoring this scope; nothing was refreshed. */
  active: z.boolean(),
  /** Monitor generation after the refresh; 0 when inactive. */
  generation: z.number().int().nonnegative(),
});
export type MonitorRefreshResponse = z.infer<
  typeof monitorRefreshResponseSchema
>;

export const filesystemProjectEntryCreateRequestSchema = z.object({
  projectId: z.string().min(1),
  parentPath: z.string().optional(),
  name: z.string().min(1),
  kind: z.enum(["file", "directory"]),
});
export type FilesystemProjectEntryCreateRequest = z.infer<
  typeof filesystemProjectEntryCreateRequestSchema
>;

export const filesystemProjectEntryCreateResponseSchema = z.object({
  entry: filesystemProjectEntrySchema,
});
export type FilesystemProjectEntryCreateResponse = z.infer<
  typeof filesystemProjectEntryCreateResponseSchema
>;

export const filesystemFileQuerySchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  line: z.coerce.number().int().positive().optional(),
});
export type FilesystemFileQuery = z.infer<typeof filesystemFileQuerySchema>;

export const filesystemFileResponseSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  relativePath: z.string(),
  name: z.string().min(1),
  size: z.number().nonnegative(),
  mtimeMs: z.number().nonnegative(),
  type: z.enum(["text", "image", "binary"]),
  binary: z.boolean(),
  text: z.string().optional(),
  dataBase64: z.string().optional(),
  mimeType: z.string().optional(),
  lineStart: z.number().int().positive().optional(),
  targetLine: z.number().int().positive().optional(),
  truncated: z.boolean(),
  editable: z.boolean().optional(),
  revision: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type FilesystemFileResponse = z.infer<
  typeof filesystemFileResponseSchema
>;

export const filesystemFileSaveRequestSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  text: z.string(),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
});
export type FilesystemFileSaveRequest = z.infer<
  typeof filesystemFileSaveRequestSchema
>;

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export const attachmentUploadRequestSchema = z.object({
  name: z.string().max(1024).optional(),
  type: z.string().max(256).default("application/octet-stream"),
  dataBase64: z
    .string()
    .max(
      Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4,
      "Attachments must be 20 MiB or smaller.",
    ),
});
export type AttachmentUploadRequest = z.infer<
  typeof attachmentUploadRequestSchema
>;

export const attachmentUploadResponseSchema = z.object({
  path: z.string().min(1),
});
export type AttachmentUploadResponse = z.infer<
  typeof attachmentUploadResponseSchema
>;

export const htmlPreviewResourceCategorySchema = z.enum([
  "script",
  "style",
  "image",
  "font",
]);
export type HtmlPreviewResourceCategory = z.infer<
  typeof htmlPreviewResourceCategorySchema
>;

export const htmlPreviewApprovalSchema = z.object({
  origin: z
    .string()
    .max(2_048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          (url.protocol === "https:" || url.protocol === "http:") &&
          url.origin === value
        );
      } catch {
        return false;
      }
    }, "Expected an exact HTTP(S) origin"),
  category: htmlPreviewResourceCategorySchema,
});
export type HtmlPreviewApproval = z.infer<typeof htmlPreviewApprovalSchema>;

export const htmlPreviewCreateRequestSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1).max(4_096),
  text: z.string().max(1_048_576),
  approvals: z.array(htmlPreviewApprovalSchema).max(128).optional(),
});
export type HtmlPreviewCreateRequest = z.infer<
  typeof htmlPreviewCreateRequestSchema
>;
export const htmlPreviewCreateResponseSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  url: z.string().regex(/^\/html-preview\/[a-f0-9]{64}\/document$/),
});
export type HtmlPreviewCreateResponse = z.infer<
  typeof htmlPreviewCreateResponseSchema
>;
export const htmlPreviewRevokeRequestSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
});
export const htmlPreviewResourceMessageSchema = z.object({
  type: z.literal("nerve:html-preview-resource"),
  category: htmlPreviewResourceCategorySchema,
  url: z.string().max(4_096).url(),
});
