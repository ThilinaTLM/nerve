import { z } from "zod";

export const assetCategorySchema = z.enum([
  "payload",
  "report",
  "image",
  "plan",
  "bash_output",
]);
export const assetSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  eventId: z.string().nullable(),
  toolCallId: z.string().nullable(),
  asyncBashId: z.string().nullable(),
  category: assetCategorySchema,
  logicalPath: z
    .string()
    .min(1)
    .refine(
      (path) =>
        !path.startsWith("/") &&
        !/^[A-Za-z]:/.test(path) &&
        !path.includes("\\") &&
        !path.split("/").includes(".."),
      "Asset paths must be relative to the data directory",
    ),
  digest: z.string().nullable(),
  byteLength: z.number().int().nonnegative(),
  mediaType: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AssetCategory = z.infer<typeof assetCategorySchema>;
export type Asset = z.infer<typeof assetSchema>;
