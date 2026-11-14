import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { repoRoot } from "../workspace/repo.ts";

const source = join(repoRoot, "packages", "skills", "src", "builtin");
const destination = join(repoRoot, "packages", "skills", "dist", "builtin");

await rm(destination, { recursive: true, force: true });
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });
