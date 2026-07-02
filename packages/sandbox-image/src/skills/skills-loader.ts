import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SandboxConfigV1, SkillStatus } from "@nervekit/shared";
export async function loadSkills(
  config: SandboxConfigV1,
  workspaceDir: string,
): Promise<SkillStatus[]> {
  if (config.skills?.enabled === false) return [];
  const roots = [config.skills?.builtin?.path ?? "/agent/skills"];
  if (config.skills?.allowWorkspaceSkills)
    roots.push(path.join(workspaceDir, ".agents", "skills"));
  roots.push(...(config.skills?.searchPaths ?? []));
  const skills: SkillStatus[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const skill of await readSkillDirs(root)) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      skills.push(skill);
    }
  }
  return skills.slice(0, config.skills?.maxSkillCount ?? 100);
}
async function readSkillDirs(root: string): Promise<SkillStatus[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const statuses: SkillStatus[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(root, entry.name, "SKILL.md");
      try {
        const raw = await readFile(skillPath);
        statuses.push({
          name: entry.name,
          source: root.startsWith("/workspace") ? "workspace" : "builtin",
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
