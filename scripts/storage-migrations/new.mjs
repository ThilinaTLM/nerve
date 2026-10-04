#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STORAGE_MIGRATION_KINDS,
  STORAGE_MIGRATIONS_DIRECTORY,
} from "../checks/storage-migration-policy.mjs";
import {
  appendRegistryEntry,
  fail,
  formatPaths,
  lockState,
  repositoryRoot,
  setChecksum,
  stepRoot,
  writeJson,
} from "./command-support.mjs";

const [kind, rawName] = process.argv.slice(2);
const name = rawName?.toLowerCase();
if (
  !STORAGE_MIGRATION_KINDS.has(kind) ||
  !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name ?? "")
) {
  fail(
    "Usage: pnpm migrations:new <schema|data|files|config> <kebab-case-name>",
  );
} else {
  try {
    const { file, lock, entries } = lockState();
    const ordinal = entries.length + 1;
    if (ordinal > 9999)
      throw new Error("migration ordinal exceeds four digits");
    const id = `${String(ordinal).padStart(4, "0")}-${name}`;
    const folder = stepRoot(id);
    if (existsSync(folder)) throw new Error(`${id} already exists`);
    mkdirSync(folder, { recursive: true });
    const factory = {
      schema: "defineSchemaStep",
      data: "defineDataStep",
      files: "defineFilesStep",
      config: "defineConfigStep",
    }[kind];
    const records = kind === "schema" ? "" : '\n  records: "derived",';
    writeFileSync(
      resolve(folder, "step.ts"),
      `import { ${factory} } from "../../kit/define-step/v1.js";\n\nexport default ${factory}({\n  id: "${id}",\n  description: "TODO: describe this migration",${records}\n  async run(_context) {\n    // TODO: implement the migration. Preserve unknown fields in stored data.\n  },\n});\n`,
    );
    writeFileSync(
      resolve(folder, "shapes.ts"),
      "// Define only the frozen, minimal persisted shapes read by this step.\nexport {};\n",
    );
    writeFileSync(
      resolve(folder, "step.test.ts"),
      `import assert from "node:assert/strict";\nimport test from "node:test";\nimport step from "./step.js";\n\ntest("${id} declares its stable identity", () => {\n  assert.equal(step.id, "${id}");\n  assert.equal(step.kind, "${kind}");\n});\n\n// TODO: exercise the previous-release and hostile storage fixtures.\n`,
    );
    const registryFile = resolve(
      repositoryRoot,
      STORAGE_MIGRATIONS_DIRECTORY,
      "steps/index.ts",
    );
    appendRegistryEntry(registryFile, id);
    formatPaths([folder, registryFile]);
    const entry = {
      id,
      kind,
      checksum: "",
      stage: "draft",
      acceptedChecksums: [],
    };
    entries.push(entry);
    setChecksum(entry);
    writeJson(file, lock);
    console.log(`Created draft migration ${id}`);
    console.log(
      "Next: implement both fixture cases, then run pnpm migrations:finalize " +
        id,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
