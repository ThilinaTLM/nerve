import { z } from "zod";
import type { DisplayKind } from "@nervekit/extension-api";

/** How the transcript renders the result of an extension's direct tool; the app has one renderer per kind. */
export const extensionDisplayKindSchema = z.enum([
  "text",
  "markdown",
  "links",
  "table",
  "artifact",
]) satisfies z.ZodType<DisplayKind>;
export type ExtensionDisplayKind = z.infer<typeof extensionDisplayKindSchema>;

/**
 * `details` of an extension direct tool's result. `value` is the method's
 * result as data (`links`: `{ title, url, snippet? }[]`, `table`: rows of
 * records, `artifact`: an artifact reference) when it is small enough to carry.
 */
export const extensionToolResultDetailsSchema = z.looseObject({
  extension: z.string(),
  tool: z.string(),
  display: z.strictObject({
    kind: extensionDisplayKindSchema,
    value: z.unknown().optional(),
  }),
});
export type ExtensionToolResultDetails = z.infer<
  typeof extensionToolResultDetailsSchema
>;
