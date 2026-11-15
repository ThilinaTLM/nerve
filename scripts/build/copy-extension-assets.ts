import { existsSync } from "node:fs";
import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../workspace/repo.ts";

// Files the host reads for each built-in extension (beside the code that owns them): quick_script
// doc topics (`docs/<file>`) and the icon (`icon.svg`)
// -> packages/extensions/dist/extension-assets/<owner>/ (the declared paths are relative to it).
const packageRoot = join(repoRoot, "packages", "extensions");
const srcRoot = join(packageRoot, "src");
const destination = join(packageRoot, "dist", "extension-assets");

await rm(destination, { recursive: true, force: true });
for (const owner of await readdir(srcRoot, { withFileTypes: true })) {
  if (!owner.isDirectory()) continue;
  const docs = join(srcRoot, owner.name, "docs");
  if (existsSync(docs))
    await cp(docs, join(destination, owner.name, "docs"), { recursive: true });
  const icon = join(srcRoot, owner.name, "icon.svg");
  if (existsSync(icon))
    await cp(icon, join(destination, owner.name, "icon.svg"));
}
