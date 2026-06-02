import { z } from "zod";

export const modeSchema = z.enum(["planning", "coding"]);
export type Mode = z.infer<typeof modeSchema>;

export const permissionLevelSchema = z.enum([
  "autonomous",
  "supervised",
  "read_only",
]);
export type PermissionLevel = z.infer<typeof permissionLevelSchema>;

export const settingsSchema = z.object({
  defaultMode: modeSchema,
  defaultPermissionLevel: permissionLevelSchema,
  defaultSubagentMode: modeSchema,
  defaultSubagentPermissionLevel: permissionLevelSchema,
  server: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().positive().default(3747),
    allowRemote: z.boolean().default(false),
  }),
  ui: z.object({
    theme: z.enum(["system", "light", "dark"]),
  }),
  compaction: z.object({
    auto: z.boolean(),
    thresholdTokens: z.number().int().positive(),
    keepRecentTokens: z.number().int().positive(),
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
    allowRemote: false,
  },
  ui: {
    theme: "system",
  },
  compaction: {
    auto: false,
    thresholdTokens: 80_000,
    keepRecentTokens: 20_000,
  },
};

export const updateSettingsRequestSchema = z.object({
  defaultMode: modeSchema.optional(),
  defaultPermissionLevel: permissionLevelSchema.optional(),
  defaultSubagentMode: modeSchema.optional(),
  defaultSubagentPermissionLevel: permissionLevelSchema.optional(),
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
    })
    .optional(),
  compaction: z
    .object({
      auto: z.boolean().optional(),
      thresholdTokens: z.number().int().positive().optional(),
      keepRecentTokens: z.number().int().positive().optional(),
    })
    .optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
