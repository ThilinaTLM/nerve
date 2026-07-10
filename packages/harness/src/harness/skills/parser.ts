import { parse } from "yaml";
import type { Result } from "../result.js";
import { toError } from "../result.js";

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  "disable-model-invocation"?: boolean;
  [key: string]: unknown;
}

export function parseFrontmatter<T extends Record<string, unknown>>(
  content: string,
): Result<{ frontmatter: T; body: string }, Error> {
  try {
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!normalized.startsWith("---"))
      return { ok: true, value: { frontmatter: {} as T, body: normalized } };
    const endIndex = normalized.indexOf("\n---", 3);
    if (endIndex === -1)
      return { ok: true, value: { frontmatter: {} as T, body: normalized } };
    const yamlString = normalized.slice(4, endIndex);
    const body = normalized.slice(endIndex + 4).trim();
    return {
      ok: true,
      value: { frontmatter: (parse(yamlString) ?? {}) as T, body },
    };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}
