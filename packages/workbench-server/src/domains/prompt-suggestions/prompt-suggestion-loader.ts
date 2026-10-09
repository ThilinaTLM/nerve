import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  PROMPT_SUGGESTION_DESCRIPTION_MAX_LENGTH,
  PROMPT_SUGGESTION_LABEL_MAX_LENGTH,
  PROMPT_SUGGESTION_NAME_MAX_LENGTH,
  PROMPT_SUGGESTION_PROMPT_MAX_LENGTH,
  promptSuggestionWhenSchema,
  type CreatePromptSuggestionRequest,
} from "@nervekit/contracts/prompt-suggestions";
import { parseFrontmatter } from "@nervekit/harness/resources";
import { stringify } from "yaml";
import { pathExists } from "../../infrastructure/storage-bootstrap/json.js";
import type {
  PromptSuggestionDefinition,
  PromptSuggestionDiagnostic,
} from "./prompt-suggestion-types.js";

type SourceInput = {
  kind: "user" | "project";
  dir: string;
  projectId?: string;
};

type Frontmatter = {
  name?: unknown;
  label?: unknown;
  description?: unknown;
  order?: unknown;
  enabled?: unknown;
  when?: unknown;
  enable?: unknown;
  "enable-js"?: unknown;
  [key: string]: unknown;
};

export async function loadPromptSuggestionDefinitions(
  inputs: SourceInput[],
): Promise<{
  definitions: PromptSuggestionDefinition[];
  diagnostics: PromptSuggestionDiagnostic[];
}> {
  const definitions: PromptSuggestionDefinition[] = [];
  const diagnostics: PromptSuggestionDiagnostic[] = [];

  for (const input of inputs) {
    if (!(await pathExists(input.dir))) continue;
    let entries: Dirent[];
    try {
      entries = await readdir(input.dir, { withFileTypes: true });
    } catch (error) {
      diagnostics.push({
        type: "warning",
        code: "list_failed",
        message: error instanceof Error ? error.message : String(error),
        path: input.dir,
      });
      continue;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        !entry.isFile() ||
        entry.name.startsWith(".") ||
        !/\.md$/i.test(entry.name)
      ) {
        continue;
      }
      const result = await loadSuggestionFile(
        input,
        join(input.dir, entry.name),
      );
      if (result.definition) definitions.push(result.definition);
      diagnostics.push(...result.diagnostics);
    }
  }

  return { definitions, diagnostics };
}

async function loadSuggestionFile(
  input: SourceInput,
  filePath: string,
): Promise<{
  definition?: PromptSuggestionDefinition;
  diagnostics: PromptSuggestionDiagnostic[];
}> {
  const diagnostics: PromptSuggestionDiagnostic[] = [];
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    diagnostics.push({
      type: "warning",
      code: "read_failed",
      message: error instanceof Error ? error.message : String(error),
      path: filePath,
    });
    return { diagnostics };
  }

  const parsed = parseFrontmatter<Frontmatter>(raw);
  if (!parsed.ok) {
    diagnostics.push({
      type: "warning",
      code: "parse_failed",
      message: parsed.error.message,
      path: filePath,
    });
    return { diagnostics };
  }
  const { frontmatter, body } = parsed.value;

  if (raw.length > PROMPT_SUGGESTION_PROMPT_MAX_LENGTH + 10_000) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: `suggestion file exceeds the supported size`,
      path: filePath,
    });
    return { diagnostics };
  }

  const fallbackName = basename(filePath).replace(/\.md$/i, "");
  const name =
    typeof frontmatter.name === "string" && frontmatter.name.trim()
      ? frontmatter.name.trim()
      : fallbackName;
  for (const message of validateName(name)) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message,
      path: filePath,
    });
  }

  const label =
    typeof frontmatter.label === "string" && frontmatter.label.trim()
      ? frontmatter.label.trim()
      : titleFromName(name);
  if (label.length > PROMPT_SUGGESTION_LABEL_MAX_LENGTH) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: `label exceeds ${PROMPT_SUGGESTION_LABEL_MAX_LENGTH} characters (${label.length})`,
      path: filePath,
    });
  }

  const description =
    typeof frontmatter.description === "string" &&
    frontmatter.description.trim()
      ? frontmatter.description.trim()
      : undefined;
  if (
    description &&
    description.length > PROMPT_SUGGESTION_DESCRIPTION_MAX_LENGTH
  ) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: `description exceeds ${PROMPT_SUGGESTION_DESCRIPTION_MAX_LENGTH} characters (${description.length})`,
      path: filePath,
    });
  }

  const promptBody = body.trim();
  if (!promptBody) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: "prompt body is required",
      path: filePath,
    });
  } else if (promptBody.length > PROMPT_SUGGESTION_PROMPT_MAX_LENGTH) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: `prompt exceeds ${PROMPT_SUGGESTION_PROMPT_MAX_LENGTH} characters (${promptBody.length})`,
      path: filePath,
    });
  }

  const order =
    typeof frontmatter.order === "number" && Number.isFinite(frontmatter.order)
      ? frontmatter.order
      : 100;
  const enabled = frontmatter.enabled !== false;
  const whenResult = promptSuggestionWhenSchema.safeParse(
    frontmatter.when ?? {},
  );
  if (!whenResult.success) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: `invalid when metadata: ${whenResult.error.issues.map((issue) => issue.message).join(", ")}`,
      path: filePath,
    });
  }

  const enableJs = normalizeEnableJs(frontmatter);
  const predicateHash = enableJs ? sha256(enableJs) : undefined;
  const absPath = resolve(filePath);
  const trustId = predicateHash
    ? sha256(`${input.kind}\0${absPath}\0${name}\0${predicateHash}`)
    : undefined;

  if (
    diagnostics.some((diagnostic) => diagnostic.code === "invalid_metadata")
  ) {
    return { diagnostics };
  }

  return {
    definition: {
      id: sha256(`${input.kind}\0${absPath}\0${name}`).slice(0, 24),
      definitionKey:
        input.kind === "project"
          ? `project:${input.projectId}:${name}`
          : `user:${name}`,
      name,
      label,
      description,
      prompt: promptBody,
      order,
      defaultEnabled: enabled,
      enabled,
      when: whenResult.data,
      enableJs,
      predicateHash,
      trustId,
      source: {
        kind: input.kind,
        path: absPath,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
    },
    diagnostics,
  };
}

function normalizeEnableJs(frontmatter: Frontmatter): string | undefined {
  if (typeof frontmatter["enable-js"] === "string") {
    return frontmatter["enable-js"].trim() || undefined;
  }
  if (
    frontmatter.enable &&
    typeof frontmatter.enable === "object" &&
    "js" in frontmatter.enable &&
    typeof frontmatter.enable.js === "string"
  ) {
    return frontmatter.enable.js.trim() || undefined;
  }
  return undefined;
}

function validateName(name: string): string[] {
  const errors: string[] = [];
  if (!name) errors.push("name is required");
  if (name.length > PROMPT_SUGGESTION_NAME_MAX_LENGTH) {
    errors.push(
      `name exceeds ${PROMPT_SUGGESTION_NAME_MAX_LENGTH} characters (${name.length})`,
    );
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push(
      "name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)",
    );
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    errors.push("name must not start or end with a hyphen");
  }
  if (name.includes("--"))
    errors.push("name must not contain consecutive hyphens");
  return errors;
}

function titleFromName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function serializePromptSuggestionMarkdown(
  input: CreatePromptSuggestionRequest,
): string {
  const frontmatter = {
    name: input.name,
    label: input.label,
    ...(input.description ? { description: input.description } : {}),
    order: 100,
  };
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${input.prompt.trim()}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
