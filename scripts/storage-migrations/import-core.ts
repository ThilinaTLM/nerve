import { parseArgs } from "node:util";
import { importCoreStorage } from "../../packages/workbench-server/src/infrastructure/core-import/importer.service.js";

try {
  const { values } = parseArgs({
    options: {
      home: { type: "string" },
      force: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  if (!values.home)
    throw new Error(
      "Usage: pnpm storage:import-core --home <NERVE_HOME> [--force]",
    );
  const summary = importCoreStorage({ home: values.home, force: values.force });
  const paths = summary.selectedPaths;
  if (
    summary.failedTrees.length ||
    paths.userMessageMismatches.length ||
    paths.headMismatches.length ||
    paths.unansweredToolCalls ||
    paths.duplicateToolResults ||
    paths.orphanToolResults
  )
    process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
