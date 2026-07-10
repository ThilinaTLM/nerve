import { z } from "zod";

export const pythonRuntimeStatusSchema = z.object({
  available: z.boolean(),
  source: z.enum([
    "manual",
    "project_venv",
    "path",
    "windows_launcher",
    "uv",
    "unavailable",
  ]),
  executable: z.string().optional(),
  version: z.string().optional(),
  error: z.string().optional(),
});
export type PythonRuntimeStatus = z.infer<typeof pythonRuntimeStatusSchema>;

export const externalEditorStatusSchema = z.object({
  available: z.boolean(),
  source: z.enum(["path", "app", "known_path"]).optional(),
  executable: z.string().optional(),
  error: z.string().optional(),
});
export type ExternalEditorStatus = z.infer<typeof externalEditorStatusSchema>;

export const externalEditorStatusesSchema = z.object({
  vscode: externalEditorStatusSchema,
  zed: externalEditorStatusSchema,
});
export type ExternalEditorStatuses = z.infer<
  typeof externalEditorStatusesSchema
>;

const mobileHttpsInfoSchema = z.object({
  port: z.number().int().positive(),
  url: z.string().url(),
  caCertUrl: z.string().url(),
});
export type MobileHttpsInfo = z.infer<typeof mobileHttpsInfoSchema>;

export const statusResponseSchema = z.object({
  daemonId: z.string().startsWith("daemon_"),
  version: z.string(),
  startedAt: z.string().datetime(),
  dataDir: z.string(),
  mobileHttps: mobileHttpsInfoSchema.optional(),
  storage: z.object({
    home: z.string(),
    sqlitePath: z.string(),
    indexHealthy: z.boolean(),
  }),
  runtime: z.object({
    python: pythonRuntimeStatusSchema,
    editors: externalEditorStatusesSchema,
  }),
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

export const daemonFileSchema = z.object({
  daemonId: z.string().startsWith("daemon_"),
  pid: z.number().int().positive(),
  host: z.string(),
  port: z.number().int().positive(),
  url: z.string().url(),
  mobileHttps: mobileHttpsInfoSchema.optional(),
  startedAt: z.string().datetime(),
  dataDir: z.string(),
  version: z.string(),
});
export type DaemonFile = z.infer<typeof daemonFileSchema>;

export const storageInfoSchema = z.object({
  dataDir: z.string(),
  sqlitePath: z.string(),
  configPath: z.string(),
  counts: z
    .object({
      projects: z.number().int().nonnegative(),
      conversations: z.number().int().nonnegative(),
      agents: z.number().int().nonnegative(),
      events: z.number().int().nonnegative(),
      tasks: z.number().int().nonnegative(),
      workers: z.number().int().nonnegative(),
    })
    .optional(),
});
export type StorageInfo = z.infer<typeof storageInfoSchema>;
