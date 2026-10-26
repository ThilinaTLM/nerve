import type {
  ProjectInstructionFile,
  ProjectInstructionsListResult,
} from "@nervekit/contracts/projects";
import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Read-only inventory. Never follows directory symlinks or escapes the project. */
export async function listProjectInstructionFiles(
  projectDir: string,
): Promise<ProjectInstructionsListResult> {
  const root = resolve(projectDir);
  const files: ProjectInstructionFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.name === "AGENTS.md" && entry.isFile()))
      files.push({ path: join(directory, "AGENTS.md"), appliesTo: directory });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        ![".git", "node_modules", ".nerve"].includes(entry.name)
      )
        await visit(join(directory, entry.name));
    }
  };
  await visit(root);
  const append = join(root, ".nerve", "APPEND_SYSTEM.md");
  try {
    if (
      !(await lstat(join(root, ".nerve"))).isSymbolicLink() &&
      (await lstat(append)).isFile()
    )
      files.push({ path: append, appliesTo: root });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}
