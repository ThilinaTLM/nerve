import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SandboxConfigV1, SkillStatus } from "@nervekit/shared";
export async function loadSkills(
  config: SandboxConfigV1,
  workspaceDir: string,
  stateDir?: string,
): Promise<SkillStatus[]> {
  if (config.skills?.enabled === false) return [];
  const roots = [config.skills?.builtin?.path ?? "/agent/skills"];
  if (config.skills?.allowWorkspaceSkills)
    roots.push(path.join(workspaceDir, ".agents", "skills"));
  roots.push(...(config.skills?.searchPaths ?? []));
  const skills: SkillStatus[] = [];
  const diagnostics: Array<{
    level: "info" | "warn";
    message: string;
    path?: string;
  }> = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const skill of await readSkillDirs(
      root,
      config.skills?.maxSkillBytes ?? 256_000,
    )) {
      if (seen.has(skill.name)) {
        diagnostics.push({
          level: "warn",
          message: `duplicate skill ignored: ${skill.name}`,
          path: skill.path,
        });
        continue;
      }
      seen.add(skill.name);
      skills.push(skill);
    }
  }
  const limited = skills.slice(0, config.skills?.maxSkillCount ?? 100);
  if (stateDir) {
    const skillsDir = path.join(stateDir, "skills");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      path.join(skillsDir, "diagnostics.json"),
      `${JSON.stringify({ skills: limited, diagnostics }, null, 2)}\n`,
    );
  }
  return limited;
}
async function readSkillDirs(
  root: string,
  maxBytes: number,
): Promise<SkillStatus[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const statuses: SkillStatus[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(root, entry.name, "SKILL.md");
      try {
        const raw = await readFile(skillPath);
        if (raw.byteLength > maxBytes) continue;
        statuses.push({
          name: entry.name,
          source:
            root.startsWith("/workspace") || root.includes("/.agents/skills")
              ? "workspace"
              : "builtin",
          path: skillPath,
          digest: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
          bytes: raw.byteLength,
          modelVisible: true,
        });
      } catch {}
    }
    return statuses;
  } catch {
    return [];
  }
}
