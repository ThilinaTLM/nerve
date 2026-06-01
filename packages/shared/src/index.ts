import { z } from "zod";

export const modeSchema = z.enum(["planning", "coding"]);
export type Mode = z.infer<typeof modeSchema>;

export const permissionLevelSchema = z.enum([
  "autonomous",
  "supervised",
  "read_only",
]);
export type PermissionLevel = z.infer<typeof permissionLevelSchema>;

export const toolRiskSchema = z.enum([
  "read",
  "plan_write",
  "workspace_write",
  "command",
  "network",
  "secret",
  "destructive",
  "agent_spawn",
  "deployment",
]);
export type ToolRisk = z.infer<typeof toolRiskSchema>;

export const eventEnvelopeSchema = z.object({
  seq: z.number().int().nonnegative(),
  id: z.string().startsWith("evt_"),
  ts: z.string().datetime(),
  type: z.string().min(1),
  data: z.unknown(),
});
export type EventEnvelope<T = unknown> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  "data"
> & {
  data: T;
};

export const settingsSchema = z.object({
  defaultMode: modeSchema,
  defaultPermissionLevel: permissionLevelSchema,
  defaultSubagentMode: modeSchema,
  defaultSubagentPermissionLevel: permissionLevelSchema,
  server: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().positive().default(3747),
  }),
  ui: z.object({
    theme: z.enum(["system", "light", "dark"]),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  defaultMode: "coding",
  defaultPermissionLevel: "supervised",
  defaultSubagentMode: "planning",
  defaultSubagentPermissionLevel: "read_only",
  server: {
    host: "127.0.0.1",
    port: 3747,
  },
  ui: {
    theme: "system",
  },
};

export const statusResponseSchema = z.object({
  daemonId: z.string().startsWith("daemon_"),
  version: z.string(),
  startedAt: z.string().datetime(),
  dataDir: z.string(),
  storage: z.object({
    home: z.string(),
    sqlitePath: z.string(),
    indexHealthy: z.boolean(),
  }),
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

export const daemonFileSchema = z.object({
  daemonId: z.string().startsWith("daemon_"),
  pid: z.number().int().positive(),
  host: z.string(),
  port: z.number().int().positive(),
  url: z.string().url(),
  startedAt: z.string().datetime(),
  dataDir: z.string(),
  version: z.string(),
});
export type DaemonFile = z.infer<typeof daemonFileSchema>;

export const storageInfoSchema = z.object({
  dataDir: z.string(),
  sqlitePath: z.string(),
  configPath: z.string(),
});
export type StorageInfo = z.infer<typeof storageInfoSchema>;

export const workspaceScopeSchema = z.object({
  roots: z.array(z.string()).min(1),
  readonly: z.boolean().optional(),
});
export type WorkspaceScope = z.infer<typeof workspaceScopeSchema>;

export const modelSelectionSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const projectRecordSchema = z.object({
  id: z.string().startsWith("proj_"),
  name: z.string().min(1),
  dir: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const createProjectRequestSchema = z.object({
  dir: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const sessionRecordSchema = z.object({
  id: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  title: z.string().min(1),
  mode: modeSchema,
  permissionLevel: permissionLevelSchema,
  activeAgentId: z.string().startsWith("agent_").optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

export const createSessionRequestSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  title: z.string().min(1).optional(),
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const agentStatusSchema = z.enum([
  "idle",
  "running",
  "aborted",
  "error",
]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const agentRecordSchema = z.object({
  id: z.string().startsWith("agent_"),
  sessionId: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  projectDir: z.string().min(1),
  parentAgentId: z.string().startsWith("agent_").optional(),
  rootAgentId: z.string().startsWith("agent_"),
  mode: modeSchema,
  permissionLevel: permissionLevelSchema,
  workspaceScope: workspaceScopeSchema,
  model: modelSelectionSchema.optional(),
  status: agentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentRecord = z.infer<typeof agentRecordSchema>;

export const createAgentRequestSchema = z.object({
  sessionId: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  projectDir: z.string().min(1).optional(),
  parentAgentId: z.string().startsWith("agent_").optional(),
  task: z.string().optional(),
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
  workspaceScope: workspaceScopeSchema.optional(),
  model: modelSelectionSchema.optional(),
});
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

export const promptRequestSchema = z.object({
  text: z.string().min(1),
  images: z
    .array(
      z.object({
        type: z.literal("image"),
        data: z.string(),
        mimeType: z.string(),
      }),
    )
    .optional(),
  behavior: z.enum(["reject-if-busy", "steer", "follow-up"]).optional(),
});
export type PromptRequest = z.infer<typeof promptRequestSchema>;

export const sessionEntrySchema = z.object({
  id: z.string().startsWith("entry_"),
  sessionId: z.string().startsWith("ses_"),
  agentId: z.string().startsWith("agent_").optional(),
  role: z.enum(["user", "assistant", "system"]),
  text: z.string(),
  createdAt: z.string().datetime(),
});
export type SessionEntry = z.infer<typeof sessionEntrySchema>;

export const modelInfoSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
  label: z.string(),
  faux: z.boolean().optional(),
});
export type ModelInfo = z.infer<typeof modelInfoSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export type IdPrefix =
  | "daemon"
  | "evt"
  | "proj"
  | "ses"
  | "agent"
  | "run"
  | "proc"
  | "entry";

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(time: number, length: number): string {
  let value = time;
  let output = "";
  for (let i = length - 1; i >= 0; i -= 1) {
    output = crockford[value % 32] + output;
    value = Math.floor(value / 32);
  }
  return output;
}

function encodeRandom(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let output = "";
  for (const byte of bytes) {
    output += crockford[byte % 32];
  }
  return output;
}

export function createId(prefix: IdPrefix): `${IdPrefix}_${string}` {
  return `${prefix}_${encodeTime(Date.now(), 10)}${encodeRandom(16)}`;
}

export function parseCookieHeader(
  header: string | null | undefined,
): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
  }
  return cookies;
}
