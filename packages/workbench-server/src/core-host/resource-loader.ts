import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  AvailableSkill,
  AvailableSkillsResponse,
  SkillSource,
} from "@nervekit/contracts/skills";
import { loadSkills, type Skill } from "@nervekit/harness/resources";
import { NodeExecutionEnv } from "@nervekit/harness/node";
import { resolveDataDir } from "../infrastructure/storage-bootstrap/paths.js";

const NERVE_DIR_NAME = ".nerve";
const AGENTS_DIR_NAME = ".agents";

export interface LoadedHarnessResources {
  contextFiles: Array<{ path: string; content: string }>;
  skills: Skill[];
  appendSystemPrompt?: string;
}

export interface LoadHarnessResourcesOptions {
  /** Prompt-file boundary; defaults to cwd for standalone callers. */
  projectDir?: string;
  storageHome?: string;
  disabledSkillNames?: readonly string[];
  enabledNerveSkillNames?: readonly string[];
  nerveSkills?: readonly Skill[];
  enabledAgentBrowserSkillNames?: readonly string[];
  agentBrowserSkills?: readonly Skill[];
}

interface DiscoveredSkillGroups {
  userSkills: Skill[];
  projectSkills: Skill[];
}

export async function loadHarnessResources(
  cwd: string,
  options: LoadHarnessResourcesOptions = {},
): Promise<LoadedHarnessResources> {
  const resolvedCwd = resolve(cwd);
  const agentDir = join(resolveDataDir(options.storageHome), "agent");
  const env = new NodeExecutionEnv({ cwd: resolvedCwd });

  const projectDir = resolve(options.projectDir ?? resolvedCwd);
  const [contextFiles, skillGroups, appendSystemPrompt] = await Promise.all([
    loadProjectContextFiles(resolvedCwd, projectDir),
    discoverSkillGroups(env, projectDir, agentDir),
    loadAppendSystemPrompt(projectDir),
  ]);
  const skills = effectiveSkills(skillGroups, options);

  return { contextFiles, skills, appendSystemPrompt };
}

async function loadProjectContextFiles(
  cwd: string,
  projectDir: string,
): Promise<Array<{ path: string; content: string }>> {
  const directories = [projectDir];
  const nested = relative(projectDir, cwd);
  // A conversation may work outside its project. Never load that location's
  // prompt files or walk above the declared project boundary.
  if (
    nested &&
    nested !== ".." &&
    !nested.startsWith(`..${sep}`) &&
    !isAbsolute(nested)
  ) {
    let directory = projectDir;
    for (const segment of nested.split(sep)) {
      directory = join(directory, segment);
      directories.push(directory);
    }
  }
  const contexts = await Promise.all(directories.map(loadContextFileFromDir));
  return contexts.filter(
    (context): context is { path: string; content: string } =>
      context !== undefined,
  );
}

async function loadContextFileFromDir(
  dir: string,
): Promise<{ path: string; content: string } | undefined> {
  const path = join(dir, "AGENTS.md");
  const content = await loadOptionalText(path);
  return content === undefined ? undefined : { path, content };
}

export async function listAvailableSkills(
  cwd: string | undefined,
  options: Pick<
    LoadHarnessResourcesOptions,
    "storageHome" | "nerveSkills" | "agentBrowserSkills"
  > = {},
): Promise<AvailableSkillsResponse> {
  const agentDir = join(resolveDataDir(options.storageHome), "agent");
  const resolvedCwd = cwd ? resolve(cwd) : undefined;
  const env = new NodeExecutionEnv({ cwd: resolvedCwd ?? agentDir });
  const groups = await discoverSkillGroups(env, resolvedCwd, agentDir);
  const toMetadata =
    (source: SkillSource) =>
    ({ name, description, filePath }: Skill): AvailableSkill => ({
      name,
      description,
      filePath,
      source,
    });
  return {
    skills: [
      ...groups.projectSkills.map(toMetadata("project")),
      ...groups.userSkills.map(toMetadata("user")),
      ...(options.nerveSkills ?? []).map(toMetadata("nerve")),
      ...(options.agentBrowserSkills ?? []).map(toMetadata("agentBrowser")),
    ],
  };
}

async function discoverSkillGroups(
  env: NodeExecutionEnv,
  cwd: string | undefined,
  agentDir: string,
): Promise<DiscoveredSkillGroups> {
  /** The home `.agents/skills` directory is always a user source, never a project one. */
  const userAgentsSkillDir = join(homedir(), AGENTS_DIR_NAME, "skills");
  const [project, user] = await Promise.all([
    cwd
      ? loadSkills(env, [
          join(cwd, NERVE_DIR_NAME, "skills"),
          ...ancestorAgentsSkillDirs(cwd, userAgentsSkillDir),
        ])
      : Promise.resolve({ skills: [], diagnostics: [] }),
    loadSkills(env, [join(agentDir, "skills"), userAgentsSkillDir]),
  ]);
  return {
    projectSkills: deduplicateSkills(project.skills),
    userSkills: deduplicateSkills(user.skills),
  };
}

function effectiveSkills(
  groups: DiscoveredSkillGroups,
  options: LoadHarnessResourcesOptions,
): Skill[] {
  const disabledSkillNames = new Set(options.disabledSkillNames ?? []);
  const enabledNerveSkillNames = new Set(options.enabledNerveSkillNames ?? []);
  const enabledAgentBrowserSkillNames = new Set(
    options.enabledAgentBrowserSkillNames ?? [],
  );
  const fileSkills = deduplicateSkills([
    ...groups.projectSkills,
    ...groups.userSkills,
  ]).filter((skill) => !disabledSkillNames.has(skill.name));
  const nerveSkills = (options.nerveSkills ?? []).filter((skill) =>
    enabledNerveSkillNames.has(skill.name),
  );
  const agentBrowserSkills = (options.agentBrowserSkills ?? []).filter(
    (skill) => enabledAgentBrowserSkillNames.has(skill.name),
  );
  return deduplicateSkills([
    ...fileSkills,
    ...nerveSkills,
    ...agentBrowserSkills,
  ]);
}

function deduplicateSkills(skills: readonly Skill[]): Skill[] {
  const byName = new Map<string, Skill>();
  for (const skill of skills) {
    if (!byName.has(skill.name)) byName.set(skill.name, skill);
  }
  return [...byName.values()];
}

function ancestorAgentsSkillDirs(cwd: string, excludedDir?: string): string[] {
  const dirs: string[] = [];
  const resolvedExcludedDir = excludedDir ? resolve(excludedDir) : undefined;
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, AGENTS_DIR_NAME, "skills");
    if (existsSync(candidate) && resolve(candidate) !== resolvedExcludedDir) {
      dirs.push(candidate);
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

function loadAppendSystemPrompt(
  projectDir: string,
): Promise<string | undefined> {
  return loadOptionalText(join(projectDir, NERVE_DIR_NAME, "APPEND_SYSTEM.md"));
}

async function loadOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
