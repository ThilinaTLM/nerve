import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { permissionRuleSetSchema } from "@nervekit/contracts/permissions";
import { builtInPermissionRuleSets } from "@nervekit/tools/policy";

export async function listPermissionRuleSets(home: string) {
  const directory = join(home, "config", "rule-sets");
  const files = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const custom = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) =>
        permissionRuleSetSchema.parse(
          JSON.parse(await readFile(join(directory, file), "utf8")),
        ),
      ),
  );
  return [...builtInPermissionRuleSets, ...custom];
}
