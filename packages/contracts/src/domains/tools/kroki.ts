import { z } from "zod";
import { toolOutputLimitsSchema } from "./tool-results.js";

export const krokiDiagramTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/);
export const krokiOutputFormatSchema = z.enum(["svg", "png"]);
export type KrokiOutputFormat = z.infer<typeof krokiOutputFormatSchema>;

export const krokiExportResultDetailsSchema = z
  .object({
    diagramType: krokiDiagramTypeSchema,
    outputFormat: krokiOutputFormatSchema,
    path: z.string().min(1),
    filename: z.string().min(1),
    mediaType: z.enum(["image/svg+xml", "image/png"]),
    bytes: z.number().int().positive(),
    outputLimits: toolOutputLimitsSchema.optional(),
  })
  .refine(
    (details) =>
      details.mediaType ===
      (details.outputFormat === "svg" ? "image/svg+xml" : "image/png"),
    {
      message: "Diagram media type must match its output format.",
    },
  );
export type KrokiExportResultDetails = z.infer<
  typeof krokiExportResultDetailsSchema
>;
