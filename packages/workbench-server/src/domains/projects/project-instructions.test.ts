import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { listProjectInstructionFiles } from "./project-instructions.js";

void test("instructions inventory is project-bounded and includes applicable nested AGENTS and only the project append file", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-instructions-"));
  try {
    const project = join(root, "project");
    for (const file of [
      join(root, "AGENTS.md"),
      join(project, "AGENTS.md"),
      join(project, "src/AGENTS.md"),
      join(project, ".nerve/APPEND_SYSTEM.md"),
      join(project, ".nerve/SYSTEM.md"),
      join(project, "node_modules/hidden/AGENTS.md"),
    ]) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "Instructions");
    }
    await symlink(root, join(project, "external-link"));
    const result = await listProjectInstructionFiles(project);
    assert.deepEqual(
      result.files,
      [
        { path: join(project, ".nerve/APPEND_SYSTEM.md"), appliesTo: project },
        { path: join(project, "AGENTS.md"), appliesTo: project },
        {
          path: join(project, "src/AGENTS.md"),
          appliesTo: join(project, "src"),
        },
      ].sort((a, b) => a.path.localeCompare(b.path)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
