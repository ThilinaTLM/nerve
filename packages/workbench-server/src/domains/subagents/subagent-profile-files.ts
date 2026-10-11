import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  SUBAGENT_INSTRUCTIONS_MAX_BYTES,
  subagentProfileFrontmatterSchema,
  subagentProfileNameSchema,
  utf8ByteLength,
  type SubagentProfile,
  type SubagentProfileDraft,
  type SubagentProfileSource,
} from "@nervekit/contracts/subagents";
import { parseFrontmatter } from "@nervekit/harness/resources";
import { stringify } from "yaml";

export type SubagentProfileDirectory = {
  source: Exclude<SubagentProfileSource, "builtin">;
  dir: string;
};

const MAX_FILE_BYTES = SUBAGENT_INSTRUCTIONS_MAX_BYTES + 32 * 1024;

export function contentDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function titleFromName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

/** Reads every `*.md` profile in a directory; one broken file never hides the others. */
export async function loadProfileDirectory(
  input: SubagentProfileDirectory,
): Promise<SubagentProfile[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(input.dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const profiles: SubagentProfile[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (
      !entry.isFile() ||
      entry.name.startsWith(".") ||
      !/\.md$/i.test(entry.name)
    )
      continue;
    const profile = await loadProfileFile(
      input.source,
      join(input.dir, entry.name),
    );
    if (profile) profiles.push(profile);
  }
  return profiles;
}

/** Returns undefined only when the file name cannot be represented as a profile name at all. */
export async function loadProfileFile(
  source: SubagentProfileDirectory["source"],
  filePath: string,
): Promise<SubagentProfile | undefined> {
  const path = resolve(filePath);
  const fileName = basename(path).replace(/\.md$/i, "");
  let name = fileName;
  const problems: string[] = [];
  if (!subagentProfileNameSchema.safeParse(name).success) {
    name = fileName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
      .replace(/-+$/g, "");
    if (!name) return undefined;
    problems.push(
      "The file name must be lowercase letters, digits and single hyphens, at most 32 characters",
    );
  }
  const invalid = (error: string, digest?: string): SubagentProfile => ({
    ...fallbackProfile(name, source, path),
    ...(digest ? { digest } : {}),
    error,
  });

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return invalid(
      `Could not read the file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const digest = contentDigest(raw);
  if (utf8ByteLength(raw) > MAX_FILE_BYTES)
    return invalid("The file is too large", digest);
  const parsed = parseFrontmatter<Record<string, unknown>>(raw);
  if (!parsed.ok)
    return invalid(`Invalid frontmatter: ${parsed.error.message}`, digest);
  const frontmatter = subagentProfileFrontmatterSchema.safeParse(
    parsed.value.frontmatter,
  );
  if (!frontmatter.success)
    return invalid(
      [
        ...problems,
        ...frontmatter.error.issues.map(
          (issue) =>
            `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
        ),
      ].join("; "),
      digest,
    );
  const instructions = parsed.value.body.trim();
  if (utf8ByteLength(instructions) > SUBAGENT_INSTRUCTIONS_MAX_BYTES)
    problems.push(
      `Instructions exceed ${SUBAGENT_INSTRUCTIONS_MAX_BYTES} bytes`,
    );
  const value = frontmatter.data;
  return {
    name,
    label: value.label ?? titleFromName(name),
    description: value.description,
    enabled: value.enabled ?? true,
    source,
    model: value.model,
    thinking: value.thinking,
    permission: value.permission,
    compaction: value.compaction,
    tools: value.tools ?? {},
    skills: value.skills,
    instructions,
    path,
    digest,
    ...(problems.length ? { error: problems.join("; ") } : {}),
  };
}

function fallbackProfile(
  name: string,
  source: SubagentProfileDirectory["source"],
  path: string,
): SubagentProfile {
  return {
    name,
    label: titleFromName(name),
    description: "",
    enabled: true,
    source,
    model: "lead",
    thinking: "lead",
    permission: "read_only",
    compaction: "inherit",
    tools: {},
    skills: "none",
    instructions: "",
    path,
  };
}

export function serializeProfileMarkdown(draft: SubagentProfileDraft): string {
  const frontmatter = {
    ...(draft.label ? { label: draft.label } : {}),
    description: draft.description,
    ...(draft.enabled !== undefined ? { enabled: draft.enabled } : {}),
    model: draft.model,
    thinking: draft.thinking,
    permission: draft.permission,
    compaction: draft.compaction,
    ...(draft.tools && Object.keys(draft.tools).length > 0
      ? { tools: draft.tools }
      : {}),
    skills: draft.skills,
  };
  const body = draft.instructions.trim();
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n${body ? `\n${body}\n` : ""}`;
}
