import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promptSuggestionWhenSchema } from "@nervekit/shared";
import { parse } from "yaml";
import { pathExists } from "../../infrastructure/storage/json.js";
import type {
  PromptSuggestionDefinition,
  PromptSuggestionDiagnostic,
} from "./prompt-suggestion-types.js";

const MAX_NAME_LENGTH = 64;
const MAX_LABEL_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 1024;

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

  let parsed: { frontmatter: Frontmatter; body: string };
  try {
    parsed = parseFrontmatter(raw);
  } catch (error) {
    diagnostics.push({
      type: "warning",
      code: "parse_failed",
      message: error instanceof Error ? error.message : String(error),
      path: filePath,
    });
    return { diagnostics };
  }

  const fallbackName = basename(filePath).replace(/\.md$/i, "");
  const name =
    typeof parsed.frontmatter.name === "string" &&
    parsed.frontmatter.name.trim()
      ? parsed.frontmatter.name.trim()
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
    typeof parsed.frontmatter.label === "string" &&
    parsed.frontmatter.label.trim()
      ? parsed.frontmatter.label.trim()
      : titleFromName(name);
  if (label.length > MAX_LABEL_LENGTH) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: `label exceeds ${MAX_LABEL_LENGTH} characters (${label.length})`,
      path: filePath,
    });
  }

  const description =
    typeof parsed.frontmatter.description === "string" &&
    parsed.frontmatter.description.trim()
      ? parsed.frontmatter.description.trim()
      : undefined;
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: `description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`,
      path: filePath,
    });
  }

  const body = parsed.body.trim();
  if (!body) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: "prompt body is required",
      path: filePath,
    });
  }

  const order =
    typeof parsed.frontmatter.order === "number" &&
    Number.isFinite(parsed.frontmatter.order)
      ? parsed.frontmatter.order
      : 100;
  const enabled = parsed.frontmatter.enabled !== false;
  const whenResult = promptSuggestionWhenSchema.safeParse(
    parsed.frontmatter.when ?? {},
  );
  if (!whenResult.success) {
    diagnostics.push({
      type: "warning",
      code: "invalid_metadata",
      message: `invalid when metadata: ${whenResult.error.issues.map((issue) => issue.message).join(", ")}`,
      path: filePath,
    });
  }

  const enableJs = normalizeEnableJs(parsed.frontmatter);
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
      name,
      label,
      description,
      prompt: body,
      order,
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

function parseFrontmatter(content: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) {
    return { frontmatter: {}, body: normalized };
  }
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return { frontmatter: {}, body: normalized };
  const yamlString = normalized.slice(4, endIndex);
  return {
    frontmatter: (parse(yamlString) ?? {}) as Frontmatter,
    body: normalized.slice(endIndex + 4).trim(),
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
  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
