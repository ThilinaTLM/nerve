import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadSkills, NodeExecutionEnv, type Skill } from "@nerve/agent";

const CONTEXT_FILE_CANDIDATES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
const CONFIG_DIR_NAME = ".pi";

export interface LoadedHarnessResources {
  contextFiles: Array<{ path: string; content: string }>;
  skills: Skill[];
  systemPrompt?: string;
  appendSystemPrompt?: string;
}

export async function loadHarnessResources(cwd: string): Promise<LoadedHarnessResources> {
  const resolvedCwd = resolve(cwd);
  const agentDir = join(homedir(), ".pi", "agent");
  const env = new NodeExecutionEnv({ cwd: resolvedCwd });

  const [contextFiles, skills, systemPrompt, appendSystemPrompt] = await Promise.all([
    loadProjectContextFiles(resolvedCwd, agentDir),
    loadProjectSkills(env, resolvedCwd, agentDir),
    loadFirstExistingText([
      join(resolvedCwd, CONFIG_DIR_NAME, "SYSTEM.md"),
      join(agentDir, "SYSTEM.md"),
    ]),
    loadAppendSystemPrompt(resolvedCwd, agentDir),
  ]);

  return { contextFiles, skills, systemPrompt, appendSystemPrompt };
}

async function loadProjectContextFiles(
  cwd: string,
  agentDir: string,
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();

  const globalContext = await loadContextFileFromDir(agentDir);
  if (globalContext) {
    files.push(globalContext);
    seen.add(globalContext.path);
  }

  const ancestors: string[] = [];
  let current = resolve(cwd);
  while (true) {
    ancestors.unshift(current);
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }

  for (const dir of ancestors) {
    const context = await loadContextFileFromDir(dir);
    if (!context || seen.has(context.path)) continue;
    files.push(context);
    seen.add(context.path);
  }

  return files;
}

async function loadContextFileFromDir(
  dir: string,
): Promise<{ path: string; content: string } | undefined> {
  for (const name of CONTEXT_FILE_CANDIDATES) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    return { path, content: await readFile(path, "utf8") };
  }
  return undefined;
}

async function loadProjectSkills(
  env: NodeExecutionEnv,
  cwd: string,
  agentDir: string,
): Promise<Skill[]> {
  const dirs = [
    join(agentDir, "skills"),
    join(cwd, CONFIG_DIR_NAME, "skills"),
    join(homedir(), ".agents", "skills"),
    ...ancestorAgentsSkillDirs(cwd),
  ];
  const loaded = await loadSkills(env, dirs);
  const byName = new Map<string, Skill>();
  for (const skill of loaded.skills) {
    if (!byName.has(skill.name)) byName.set(skill.name, skill);
  }
  return [...byName.values()];
}

function ancestorAgentsSkillDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, ".agents", "skills");
    if (existsSync(candidate)) dirs.unshift(candidate);
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

async function loadFirstExistingText(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    return readFile(path, "utf8");
  }
  return undefined;
}

async function loadAppendSystemPrompt(
  cwd: string,
  agentDir: string,
): Promise<string | undefined> {
  const values = await Promise.all(
    [join(cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md"), join(agentDir, "APPEND_SYSTEM.md")]
      .filter((path) => existsSync(path))
      .map((path) => readFile(path, "utf8")),
  );
  return values.length > 0 ? values.join("\n\n") : undefined;
}
