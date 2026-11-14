import { existsSync } from "node:fs";
import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../workspace/repo.ts";

// quick_script doc topics of each built-in extension (Markdown beside the code that owns them)
// -> packages/extensions/dist/extension-docs/<owner>/.
const packageRoot = join(repoRoot, "packages", "extensions");
const srcRoot = join(packageRoot, "src");
const destination = join(packageRoot, "dist", "extension-docs");

await rm(destination, { recursive: true, force: true });
for (const owner of await readdir(srcRoot, { withFileTypes: true })) {
  const docs = join(srcRoot, owner.name, "docs");
  if (owner.isDirectory() && existsSync(docs))
    await cp(docs, join(destination, owner.name), { recursive: true });
}
