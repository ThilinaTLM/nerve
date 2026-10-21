import { z } from "zod";

/** JSON dictionaries must preserve own keys, including constructor and __proto__. */
export function agentProfileRecordSchema<V extends z.ZodType>(
  keySchema: z.ZodType<string>,
  valueSchema: V,
) {
  return z
    .custom<Record<string, z.input<V>>>((value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    }, "Expected a JSON dictionary")
    .transform((value, context): Record<string, z.output<V>> => {
      const entries: [string, z.output<V>][] = [];
      for (const [key, item] of Object.entries(value)) {
        const parsedKey = keySchema.safeParse(key);
        const parsedValue = valueSchema.safeParse(item);
        if (!parsedKey.success)
          for (const issue of parsedKey.error.issues)
            context.addIssue({ ...issue, path: [key, ...issue.path] });
        if (!parsedValue.success)
          for (const issue of parsedValue.error.issues)
            context.addIssue({ ...issue, path: [key, ...issue.path] });
        if (parsedKey.success && parsedValue.success)
          entries.push([parsedKey.data, parsedValue.data]);
      }
      // fromEntries uses own data properties instead of invoking prototype setters.
      return Object.fromEntries(entries);
    });
}
