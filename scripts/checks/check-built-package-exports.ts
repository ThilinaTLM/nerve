import { CliError, defineCli } from "../cli/main.ts";
import { repoRoot } from "../workspace/repo.ts";
import { validateBuiltPackageExportTargets } from "./package-export-surfaces.ts";

await defineCli(import.meta.url, () => {
  const failures = validateBuiltPackageExportTargets(repoRoot);
  if (failures.length)
    throw new CliError(
      [
        "Built package export validation failed:",
        ...failures.map((failure) => `- ${failure}`),
      ].join("\n"),
    );
});
