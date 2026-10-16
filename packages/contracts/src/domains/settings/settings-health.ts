import { z } from "zod";

export const settingsDocumentIdSchema = z.enum([
  "daemon",
  "harness",
  "ui",
  "permissions",
  "providers",
  "integrations",
]);
export type SettingsDocumentId = z.infer<typeof settingsDocumentIdSchema>;

export const settingsHealthSchema = z.object({
  invalid: z.array(
    z.object({
      id: settingsDocumentIdSchema,
      path: z.string(),
      reason: z.string(),
    }),
  ),
});
export type SettingsHealth = z.infer<typeof settingsHealthSchema>;

export const settingsResolutionRequestSchema = z
  .object({
    id: settingsDocumentIdSchema,
    action: z.enum(["reset", "reload"]),
  })
  .strict();
export type SettingsResolutionRequest = z.infer<
  typeof settingsResolutionRequestSchema
>;
