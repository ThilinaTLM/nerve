import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { repoRoot } from "../workspace/repo.ts";

const root = join(repoRoot, "packages", "workbench-server");
const source = join(root, "src", "builtin-skills", "builtin");
const destination = join(root, "dist", "builtin-skills", "builtin");

await rm(destination, { recursive: true, force: true });
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });
