import { z } from "zod";
import type {
  ToolView,
  ViewSection,
  ViewSectionType,
} from "@nervekit/extension-api";

/** How a section of an extension tool's card renders its value; the app has one renderer per type. */
export const extensionViewSectionTypeSchema = z.enum([
  "text",
  "markdown",
  "links",
  "table",
  "artifacts",
]) satisfies z.ZodType<ViewSectionType>;
export type ExtensionViewSectionType = z.infer<
  typeof extensionViewSectionTypeSchema
>;

/** A section id; also the live stream id `ctx.progress` writes to. */
export const extensionViewSectionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/);

export const extensionViewSectionSchema = z.strictObject({
  id: extensionViewSectionIdSchema,
  type: extensionViewSectionTypeSchema,
  label: z.string().min(1).max(64).optional(),
  live: z.enum(["stream", "transient"]).optional(),
}) satisfies z.ZodType<ViewSection>;
export type ExtensionViewSection = z.infer<typeof extensionViewSectionSchema>;

/** How the transcript card shows an extension's direct tool (`ToolView` of the extension API). */
export const extensionToolViewSchema = z.strictObject({
  header: z
    .strictObject({
      argument: z.string().min(1),
      format: z.enum(["text", "path"]).optional(),
    })
    .optional(),
  meta: z.array(z.string().min(1)).max(3).optional(),
  sections: z.array(extensionViewSectionSchema).min(1),
}) satisfies z.ZodType<ToolView>;
export type ExtensionToolView = z.infer<typeof extensionToolViewSchema>;

/**
 * `details` of an extension direct tool's result. `sections` lists the view
 * sections that have a value, in view order, with what renders them, so a
 * stored result renders without the tool's current declaration. Values are
 * data (`links`: `{ title, url, snippet? }[]`, `table`: rows of records,
 * `artifacts`: artifact handles), carried when small enough.
 */
export const extensionToolResultDetailsSchema = z.looseObject({
  extension: z.string(),
  tool: z.string(),
  sections: z.array(
    z.strictObject({
      id: extensionViewSectionIdSchema,
      type: extensionViewSectionTypeSchema,
      label: z.string().optional(),
      value: z.unknown(),
    }),
  ),
});
export type ExtensionToolResultDetails = z.infer<
  typeof extensionToolResultDetailsSchema
>;
