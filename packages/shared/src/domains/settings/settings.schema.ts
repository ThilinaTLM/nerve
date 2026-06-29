import { z } from "zod";
import { applicationLogLevelSchema } from "../logs/index.js";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/index.js";

export const modeSchema = z.enum(["planning", "coding"]);
export type Mode = z.infer<typeof modeSchema>;

export const permissionLevelSchema = z.enum([
  "autonomous",
  "supervised",
  "read_only",
]);
export type PermissionLevel = z.infer<typeof permissionLevelSchema>;

export const agentSelectionSettingsSchema = z.object({
  mode: modeSchema.default("coding"),
  permissionLevel: permissionLevelSchema.default("autonomous"),
  model: modelSelectionSchema.optional(),
  thinkingLevel: thinkingLevelSchema.default("off"),
});
export type AgentSelectionSettings = z.infer<
  typeof agentSelectionSettingsSchema
>;

const runtimeSettingsSchema = z.object({
  pythonExecutablePath: z.string().trim().min(1).optional(),
  shellPath: z.string().trim().min(1).optional(),
});

export const settingsSchema = z.object({
  defaultMode: modeSchema,
  defaultPermissionLevel: permissionLevelSchema,
  defaultModel: modelSelectionSchema.optional(),
  defaultThinkingLevel: thinkingLevelSchema.default("off"),
  rememberLastAgentSelection: z.boolean().default(false),
  lastAgentSelection: agentSelectionSettingsSchema.default({
    mode: "coding",
    permissionLevel: "autonomous",
    thinkingLevel: "off",
  }),
  exploreAgent: z.object({
    model: modelSelectionSchema.optional(),
    thinkingLevel: thinkingLevelSchema.default("off"),
  }),
  server: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().positive().default(3747),
    allowRemote: z.boolean().default(false),
  }),
  ui: z.object({
    theme: z.enum(["system", "light", "dark"]),
    zoomLevel: z.number().int().min(-8).max(8).default(0),
  }),
  desktop: z.object({
    closeToTray: z.boolean().default(true),
  }),
  compaction: z.object({
    auto: z.boolean().default(true),
  }),
  logging: z.object({
    level: applicationLogLevelSchema.default("info"),
    retentionDays: z.number().int().positive().default(14),
    maxBufferedLogs: z.number().int().positive().default(2000),
  }),
  retry: z.object({
    enabled: z.boolean().default(true),
    maxRetries: z.number().int().nonnegative().default(3),
    baseDelayMs: z.number().int().positive().default(2000),
  }),
  runtime: runtimeSettingsSchema.default({}),
  scopedModels: z.array(modelSelectionSchema).default([]),
});
export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  defaultMode: "coding",
  defaultPermissionLevel: "autonomous",
  defaultThinkingLevel: "off",
  rememberLastAgentSelection: false,
  lastAgentSelection: {
    mode: "coding",
    permissionLevel: "autonomous",
    thinkingLevel: "off",
  },
  exploreAgent: {
    thinkingLevel: "off",
  },
  server: {
    host: "127.0.0.1",
    port: 3747,
    allowRemote: false,
  },
  ui: {
    theme: "system",
    zoomLevel: 0,
  },
  desktop: {
    closeToTray: true,
  },
  compaction: {
    auto: true,
  },
  logging: {
    level: "info",
    retentionDays: 14,
    maxBufferedLogs: 2000,
  },
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 2000,
  },
  runtime: {},
  scopedModels: [],
};

export const updateSettingsRequestSchema = z.object({
  defaultMode: modeSchema.optional(),
  defaultPermissionLevel: permissionLevelSchema.optional(),
  defaultModel: modelSelectionSchema.nullable().optional(),
  defaultThinkingLevel: thinkingLevelSchema.optional(),
  rememberLastAgentSelection: z.boolean().optional(),
  lastAgentSelection: z
    .object({
      mode: modeSchema.optional(),
      permissionLevel: permissionLevelSchema.optional(),
      model: modelSelectionSchema.nullable().optional(),
      thinkingLevel: thinkingLevelSchema.optional(),
    })
    .optional(),
  exploreAgent: z
    .object({
      model: modelSelectionSchema.nullable().optional(),
      thinkingLevel: thinkingLevelSchema.optional(),
    })
    .optional(),
  server: z
    .object({
      host: z.string().optional(),
      port: z.number().int().positive().optional(),
      allowRemote: z.boolean().optional(),
    })
    .optional(),
  ui: z
    .object({
      theme: z.enum(["system", "light", "dark"]).optional(),
      zoomLevel: z.number().int().min(-8).max(8).optional(),
    })
    .optional(),
  desktop: z
    .object({
      closeToTray: z.boolean().optional(),
    })
    .optional(),
  compaction: z
    .object({
      auto: z.boolean().optional(),
    })
    .optional(),
  logging: z
    .object({
      level: applicationLogLevelSchema.optional(),
      retentionDays: z.number().int().positive().optional(),
      maxBufferedLogs: z.number().int().positive().optional(),
    })
    .optional(),
  retry: z
    .object({
      enabled: z.boolean().optional(),
      maxRetries: z.number().int().nonnegative().optional(),
      baseDelayMs: z.number().int().positive().optional(),
    })
    .optional(),
  runtime: z
    .object({
      pythonExecutablePath: z.string().trim().min(1).nullable().optional(),
      shellPath: z.string().trim().min(1).nullable().optional(),
    })
    .optional(),
  scopedModels: z.array(modelSelectionSchema).optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
