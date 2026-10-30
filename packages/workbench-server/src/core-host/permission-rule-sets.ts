import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { permissionRuleSetSchema } from "@nervekit/contracts/permissions";
import { builtInPermissionRuleSets } from "@nervekit/tools/policy";
import { userConfigurationRoot } from "../infrastructure/configuration/scope-paths.js";

export async function listPermissionRuleSets(home: string) {
  const directory = join(userConfigurationRoot(home), "rule-sets");
  const files = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const custom = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        try {
          return permissionRuleSetSchema.parse(
            JSON.parse(await readFile(join(directory, file), "utf8")),
          );
        } catch {
          // Isolate malformed or unreadable custom files, just like execution's
          // scoped permission source. Never substitute a permissive rule set.
          return undefined;
        }
      }),
  );
  return [
    ...builtInPermissionRuleSets,
    ...custom.filter((ruleSet) => ruleSet !== undefined),
  ];
}
