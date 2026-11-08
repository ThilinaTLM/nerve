import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Nearest ancestor directory of a module that contains a package.json. The
 * compiled workspace layout (dist/<area>/*.js) and the flat release bundle
 * (dist/*.js) both sit under the package root, so package-relative assets
 * (package.json, dist/web) resolve the same way in either.
 */
export function findPackageRoot(moduleUrl: string): string {
  let directory = dirname(fileURLToPath(moduleUrl));
  while (!existsSync(join(directory, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error(`Could not locate a package root for ${moduleUrl}.`);
    directory = parent;
  }
  return directory;
}
