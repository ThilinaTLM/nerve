// `prepack` of the independently published packages (extension-api, ui-kit, extension-sdk):
// copies the repository LICENSE and NOTICE into the package folder so the tarball carries them.
// The copies are git-ignored. Runs with the package folder as the working directory.
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const name of ["LICENSE", "NOTICE"]) copyFileSync(join(root, name), name);
