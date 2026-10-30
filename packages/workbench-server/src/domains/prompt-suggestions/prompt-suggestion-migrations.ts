import {
  PROMPT_SUGGESTION_PROMPT_MAX_LENGTH,
  promptSuggestionWhenSchema,
} from "@nervekit/contracts/prompt-suggestions";
import { basename } from "node:path";
import { z } from "zod";
import { parseFrontmatter } from "@nervekit/harness/resources";
import { stringify } from "yaml";
import type { ProjectConfigurationType } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { parseSuggestionMarkdown } from "./prompt-suggestion-document.js";
export interface SuggestionDocument {
  schemaVersion: 2;
  frontmatter: Record<string, unknown>;
  body: string;
}
function decode(bytes: string): unknown {
  if (bytes.length > PROMPT_SUGGESTION_PROMPT_MAX_LENGTH + 10_000)
    throw new Error("Suggestion exceeds the supported size");
  const parsed = parseFrontmatter<Record<string, unknown>>(bytes);
  if (!parsed.ok) throw parsed.error;
  const { schemaVersion = 1, ...frontmatter } = parsed.value.frontmatter;
  return { schemaVersion, frontmatter, body: parsed.value.body };
}
function encode(value: SuggestionDocument | null): string {
  if (!value) throw new Error("Missing suggestion");
  return `---\n${stringify({ ...value.frontmatter, schemaVersion: 2 }).trimEnd()}\n---\n\n${value.body.trim()}\n`;
}
// Frozen v1 spelling: enable.js becomes enable-js only in this version step.
export function migrateSuggestionV1(value: unknown): unknown {
  const old = z
    .object({
      schemaVersion: z.literal(1),
      frontmatter: z.record(z.string(), z.unknown()),
      body: z.string(),
    })
    .strict()
    .parse(value);
  const fields = { ...old.frontmatter };
  if (fields.enable !== undefined) {
    const enabled = z.object({ js: z.string() }).strict().parse(fields.enable);
    if (fields["enable-js"] !== undefined && fields["enable-js"] !== enabled.js)
      throw new Error("Conflicting suggestion predicates");
    fields["enable-js"] = enabled.js;
    delete fields.enable;
  }
  return { schemaVersion: 2, frontmatter: fields, body: old.body };
}
const cache = new Map<
  string,
  ProjectConfigurationType<SuggestionDocument | null>
>();
export function suggestionConfiguration(
  filename: string,
): ProjectConfigurationType<SuggestionDocument | null> {
  if (filename !== basename(filename) || !/^[^.][^/\\]*\.md$/i.test(filename))
    throw new Error("Invalid suggestion filename");
  const existing = cache.get(filename);
  if (existing) return existing;
  const type: ProjectConfigurationType<SuggestionDocument | null> = {
    id: `prompt-suggestion:${filename}`,
    label: `Prompt suggestion: ${filename}`,
    resetDescription: `Quarantine ${filename}; this suggestion will no longer be active.`,
    fallbackDescription:
      "This suggestion is omitted; other suggestions remain available.",
    path: `suggestions/${filename}`,
    currentVersion: 2,
    version: { field: "schemaVersion", absent: 1 },
    decode,
    encode,
    migrators: { 1: migrateSuggestionV1 },
    schema: {
      parse(value) {
        const parsed = z
          .object({
            schemaVersion: z.literal(2),
            frontmatter: z.record(z.string(), z.unknown()),
            body: z.string(),
          })
          .strict()
          .parse(value);
        parsed.frontmatter = z
          .object({
            name: z.string().optional(),
            label: z.string().optional(),
            description: z.string().optional(),
            order: z.number().finite().optional(),
            enabled: z.boolean().optional(),
            when: promptSuggestionWhenSchema.optional(),
            "enable-js": z.string().optional(),
          })
          .strict()
          .parse(parsed.frontmatter);
        const result = parseSuggestionMarkdown(
          { kind: "project", dir: "", projectId: "validation" },
          filename,
          encode(parsed),
        );
        if (!result.definition)
          throw new Error(
            result.diagnostics.map((issue) => issue.message).join("; "),
          );
        return parsed;
      },
    },
    fallback: () => null,
    reset: () => null,
    trustKind: "prompt_suggestion",
  };
  cache.set(filename, type);
  return type;
}
