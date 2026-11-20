import type { FileDiagnostic } from "@nervekit/contracts/configuration";
import ignore from "ignore";
import type { ExecutionEnv } from "../../environment/contracts.js";
import type { Skill } from "./skill.js";
import {
  basenameEnvPath,
  dirnameEnvPath,
  joinEnvPath,
  relativeEnvPath,
} from "../../paths.js";
import { resolveKind } from "../resolve-kind.js";
import { parseFrontmatter, type SkillFrontmatter } from "./parser.js";
import { IGNORE_FILE_NAMES, prefixIgnorePattern } from "./ignore-rules.js";
import { validateDescription, validateName } from "./validation.js";

type IgnoreMatcher = ReturnType<typeof ignore>;

export type SkillDiagnosticCode =
  | "file-info-failed"
  | "list-failed"
  | "read-failed"
  | "parse-failed"
  | "invalid-metadata";

/**
 * Produced while loading skills. `error`: the skill (or the folder) did not load.
 * `warning`: it loaded, with metadata that breaks a rule.
 */
export type SkillDiagnostic = FileDiagnostic & { code: SkillDiagnosticCode };

/**
 * Load skills from one or more directories.
 *
 * Traverses directories recursively, loads `SKILL.md` files, loads direct root `.md` files as skills, honors ignore files,
 * and returns diagnostics for invalid skill files. Missing input directories are skipped.
 */
export async function loadSkills(
  env: ExecutionEnv,
  dirs: string | string[],
): Promise<{ skills: Skill[]; diagnostics: SkillDiagnostic[] }> {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
    const rootInfoResult = await env.fileInfo(dir);
    if (!rootInfoResult.ok) {
      if (rootInfoResult.error.code !== "not_found") {
        diagnostics.push({
          level: "error",
          code: "file-info-failed",
          message: rootInfoResult.error.message,
          path: dir,
        });
      }
      continue;
    }
    const rootInfo = rootInfoResult.value;
    if ((await resolveKind(env, rootInfo, diagnostics)) !== "directory")
      continue;
    const result = await loadSkillsFromDirInternal(
      env,
      rootInfo.path,
      true,
      ignore(),
      rootInfo.path,
    );
    skills.push(...result.skills);
    diagnostics.push(...result.diagnostics);
  }
  return { skills, diagnostics };
}

/**
 * Load skills from source-tagged directories.
 *
 * Source values are preserved exactly and attached to every loaded skill and diagnostic. The agent package does not
 * interpret source values; applications define their own provenance shape.
 */
export async function loadSourcedSkills<TSource, TSkill extends Skill = Skill>(
  env: ExecutionEnv,
  inputs: Array<{ path: string; source: TSource }>,
  mapSkill?: (skill: Skill, source: TSource) => TSkill,
): Promise<{
  skills: Array<{ skill: TSkill; source: TSource }>;
  diagnostics: Array<SkillDiagnostic & { source: TSource }>;
}> {
  const skills: Array<{ skill: TSkill; source: TSource }> = [];
  const diagnostics: Array<SkillDiagnostic & { source: TSource }> = [];
  for (const input of inputs) {
    const result = await loadSkills(env, input.path);
    for (const skill of result.skills) {
      skills.push({
        skill: mapSkill ? mapSkill(skill, input.source) : (skill as TSkill),
        source: input.source,
      });
    }
    for (const diagnostic of result.diagnostics)
      diagnostics.push({ ...diagnostic, source: input.source });
  }
  return { skills, diagnostics };
}

async function loadSkillsFromDirInternal(
  env: ExecutionEnv,
  dir: string,
  includeRootFiles: boolean,
  ignoreMatcher: IgnoreMatcher,
  rootDir: string,
): Promise<{ skills: Skill[]; diagnostics: SkillDiagnostic[] }> {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];

  const dirInfoResult = await env.fileInfo(dir);
  if (!dirInfoResult.ok) {
    if (dirInfoResult.error.code !== "not_found") {
      diagnostics.push({
        level: "error",
        code: "file-info-failed",
        message: dirInfoResult.error.message,
        path: dir,
      });
    }
    return { skills, diagnostics };
  }
  const dirInfo = dirInfoResult.value;
  if ((await resolveKind(env, dirInfo, diagnostics)) !== "directory")
    return { skills, diagnostics };

  await addIgnoreRules(env, ignoreMatcher, dir, rootDir, diagnostics);

  const entriesResult = await env.listDir(dir);
  if (!entriesResult.ok) {
    diagnostics.push({
      level: "error",
      code: "list-failed",
      message: entriesResult.error.message,
      path: dir,
    });
    return { skills, diagnostics };
  }
  const entries = entriesResult.value;

  for (const entry of entries) {
    if (entry.name !== "SKILL.md") continue;
    const fullPath = entry.path;
    const kind = await resolveKind(env, entry, diagnostics);
    if (kind !== "file") continue;
    const relPath = relativeEnvPath(rootDir, fullPath);
    if (ignoreMatcher.ignores(relPath)) continue;

    const result = await loadSkillFromFile(env, fullPath);
    if (result.skill) skills.push(result.skill);
    diagnostics.push(...result.diagnostics);
    return { skills, diagnostics };
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = entry.path;
    const kind = await resolveKind(env, entry, diagnostics);
    if (!kind) continue;

    const relPath = relativeEnvPath(rootDir, fullPath);
    const ignorePath = kind === "directory" ? `${relPath}/` : relPath;
    if (ignoreMatcher.ignores(ignorePath)) continue;

    if (kind === "directory") {
      const result = await loadSkillsFromDirInternal(
        env,
        fullPath,
        false,
        ignoreMatcher,
        rootDir,
      );
      skills.push(...result.skills);
      diagnostics.push(...result.diagnostics);
      continue;
    }

    if (kind !== "file" || !includeRootFiles || !entry.name.endsWith(".md"))
      continue;
    const result = await loadSkillFromFile(env, fullPath);
    if (result.skill) skills.push(result.skill);
    diagnostics.push(...result.diagnostics);
  }

  return { skills, diagnostics };
}

async function addIgnoreRules(
  env: ExecutionEnv,
  ig: IgnoreMatcher,
  dir: string,
  rootDir: string,
  diagnostics: SkillDiagnostic[],
): Promise<void> {
  const relativeDir = relativeEnvPath(rootDir, dir);
  const prefix = relativeDir ? `${relativeDir}/` : "";

  for (const filename of IGNORE_FILE_NAMES) {
    const ignorePath = joinEnvPath(dir, filename);
    const info = await env.fileInfo(ignorePath);
    if (!info.ok) {
      if (info.error.code !== "not_found") {
        diagnostics.push({
          level: "warning",
          code: "file-info-failed",
          message: info.error.message,
          path: ignorePath,
        });
      }
      continue;
    }
    if (info.value.kind !== "file") continue;
    const content = await env.readTextFile(ignorePath);
    if (!content.ok) {
      diagnostics.push({
        level: "warning",
        code: "read-failed",
        message: content.error.message,
        path: ignorePath,
      });
      continue;
    }
    const patterns = content.value
      .split(/\r?\n/)
      .map((line) => prefixIgnorePattern(line, prefix))
      .filter((line): line is string => Boolean(line));
    if (patterns.length > 0) ig.add(patterns);
  }
}

async function loadSkillFromFile(
  env: ExecutionEnv,
  filePath: string,
): Promise<{ skill: Skill | null; diagnostics: SkillDiagnostic[] }> {
  const diagnostics: SkillDiagnostic[] = [];
  const rawContent = await env.readTextFile(filePath);
  if (!rawContent.ok) {
    diagnostics.push({
      level: "error",
      code: "read-failed",
      message: rawContent.error.message,
      path: filePath,
    });
    return { skill: null, diagnostics };
  }

  const parsed = parseFrontmatter<SkillFrontmatter>(rawContent.value);
  if (!parsed.ok) {
    diagnostics.push({
      level: "error",
      code: "parse-failed",
      message: parsed.error.message,
      path: filePath,
    });
    return { skill: null, diagnostics };
  }

  const { frontmatter, body } = parsed.value;
  const skillDir = dirnameEnvPath(filePath);
  const parentDirName = basenameEnvPath(skillDir);
  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description
      : undefined;

  const missingDescription = !description || description.trim() === "";
  for (const error of validateDescription(description)) {
    diagnostics.push({
      level: missingDescription ? "error" : "warning",
      code: "invalid-metadata",
      message: error,
      path: filePath,
    });
  }

  const frontmatterName =
    typeof frontmatter.name === "string" ? frontmatter.name : undefined;
  const name = frontmatterName || parentDirName;
  for (const error of validateName(name, parentDirName)) {
    diagnostics.push({
      level: "warning",
      code: "invalid-metadata",
      message: error,
      path: filePath,
    });
  }

  if (missingDescription) {
    return { skill: null, diagnostics };
  }

  return {
    skill: {
      name,
      description,
      content: body,
      filePath,
      disableModelInvocation: frontmatter["disable-model-invocation"] === true,
    },
    diagnostics,
  };
}
