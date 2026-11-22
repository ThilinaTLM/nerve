import { z } from "zod";

// Its own module so theme-file.ts (read by ui-kit tests from source) stays free of extension-api.
/** Id of a preview, page, panel or theme: kebab-case, unique within its kind. */
export const uiContributionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "must be kebab-case")
  .max(64);
