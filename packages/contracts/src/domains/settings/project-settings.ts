import { z } from "zod";
import { harnessConfigSchema } from "./home-configuration.js";

// Project capability selections live in capabilities.json, not harness.json.
const projectHarnessSchema = harnessConfigSchema
  .omit({ version: true })
  .extend({
    tools: harnessConfigSchema.shape.tools.omit({ disabled: true }),
    skills: harnessConfigSchema.shape.skills.omit({
      disabled: true,
      agentBrowser: true,
    }),
  });

type Sparse<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: Sparse<T[K]> }
    : T;
type Patch<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: Patch<T[K]> | null }
    : T;
type ProjectHarness = z.infer<typeof projectHarnessSchema>;
export type ProjectHarnessOverrides = Sparse<ProjectHarness> & { version?: 3 };
export type ProjectSettingsPatch = Patch<ProjectHarness>;

/** Objects merge recursively; arrays replace as a whole. Defaults are never saved implicitly. */
function sparseSchema(
  schema: z.ZodType,
  mode: "read" | "known" | "patch",
): z.ZodType {
  while (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault)
    schema = schema.unwrap() as z.ZodType;
  if (schema instanceof z.ZodPipe)
    return sparseSchema(schema.out as z.ZodType, mode);
  if (schema instanceof z.ZodUnion)
    return z.union(
      schema.options.map((option) => sparseSchema(option as z.ZodType, mode)),
    );
  if (schema instanceof z.ZodObject) {
    const fields = Object.fromEntries(
      Object.entries(schema.shape).map(([key, field]) => {
        const value = sparseSchema(field as z.ZodType, mode);
        return [key, (mode === "patch" ? value.nullable() : value).optional()];
      }),
    );
    const object = z.object(fields);
    return mode === "patch"
      ? object.strict()
      : mode === "read"
        ? object.passthrough()
        : object.strip();
  }
  return schema;
}

/** Validates own overrides while retaining extension data in responses and on disk. */
export const projectHarnessOverridesSchema = sparseSchema(
  projectHarnessSchema.extend({ version: z.literal(3) }),
  "read",
) as z.ZodType<ProjectHarnessOverrides, ProjectHarnessOverrides>;
/** The validated known-field projection used for effective harness resolution. */
export const projectHarnessValuesSchema = sparseSchema(
  projectHarnessSchema,
  "known",
) as z.ZodType<Sparse<ProjectHarness>>;
/** Null removes a known key at any depth; extension keys cannot be edited through this API. */
export const projectSettingsPatchSchema = sparseSchema(
  projectHarnessSchema,
  "patch",
) as z.ZodType<ProjectSettingsPatch, ProjectSettingsPatch>;

export const projectSettingsResultSchema = z.object({
  overrides: projectHarnessOverridesSchema,
  inherited: harnessConfigSchema,
  effective: harnessConfigSchema,
});
export type ProjectSettingsResult = z.infer<typeof projectSettingsResultSchema>;
