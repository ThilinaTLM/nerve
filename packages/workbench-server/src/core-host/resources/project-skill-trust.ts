import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { toTrustedDigest } from "@nervekit/contracts/core";
import type { SkillReview, SkillReviewFile } from "@nervekit/contracts/skills";
import type { CoreStorage } from "@nervekit/conversation-core";
import { listUnignoredEntries, type Skill } from "@nervekit/harness/resources";

const SCRIPT_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd",
  ".py",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".rb",
  ".pl",
  ".php",
  ".lua",
]);
/** A folder larger than this is not a skill; it is not hashed and cannot be approved. */
const MAX_FILES = 2_000;

export type ProjectSkillStatus = "approved" | "pending" | "changed";

/**
 * Approval of project skills (trust kind `project_skill`). A skill that arrives with a
 * repository can carry scripts it tells the agent to run, so it is used only after the user
 * approved the exact content of its folder. See docs/architecture/trust.md.
 */
export interface ProjectSkillTrust {
  /** Whether the agent may be told about the skill. */
  status(projectId: string, skill: Skill): Promise<ProjectSkillStatus>;
  /** What the user reviews: every file of the folder and the digest an approval names. */
  review(projectId: string, skill: Skill): Promise<SkillReview>;
}

async function files(folder: string): Promise<SkillReviewFile[]> {
  const found: SkillReviewFile[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await listUnignoredEntries(directory)) {
      if (found.length > MAX_FILES) return;
      const path = join(directory, entry.name);
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory) {
        await walk(path, `${relative}/`);
        continue;
      }
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile()) continue;
      found.push({
        path: relative,
        bytes: info.size,
        script:
          SCRIPT_EXTENSIONS.has(extname(entry.name).toLowerCase()) ||
          (process.platform !== "win32" && (info.mode & 0o111) !== 0),
      });
    }
  };
  await walk(folder, "");
  // Code-unit order: the digest must not depend on the machine's locale.
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function digest(
  folder: string,
  listed: readonly SkillReviewFile[],
): Promise<string> {
  const hash = createHash("sha256");
  if (listed.length > MAX_FILES) hash.update("too-many-files\0");
  for (const file of listed) {
    const content = await readFile(join(folder, file.path));
    hash
      .update(`${file.path}\0${content.length}\0`)
      .update(content)
      .update("\0");
  }
  return toTrustedDigest(hash.digest("hex"));
}

export function createProjectSkillTrust(
  trustedResources: Pick<CoreStorage["trustedResources"], "find">,
): ProjectSkillTrust {
  async function review(projectId: string, skill: Skill): Promise<SkillReview> {
    const folder = dirname(skill.filePath);
    const listed = await files(folder);
    const contentDigest = await digest(folder, listed);
    const row = trustedResources.find("project_skill", projectId, folder);
    return {
      name: skill.name,
      description: skill.description,
      folder,
      contentDigest,
      files: listed.slice(0, MAX_FILES),
      status:
        row?.status !== "trusted" || listed.length > MAX_FILES
          ? "pending"
          : row.contentDigest === contentDigest
            ? "approved"
            : "changed",
    };
  }
  return {
    review,
    status: async (projectId, skill) => (await review(projectId, skill)).status,
  };
}
