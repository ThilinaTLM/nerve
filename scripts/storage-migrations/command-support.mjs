import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readStorageMigrationLock,
  STORAGE_MIGRATIONS_DIRECTORY,
  storageMigrationLockMetadataViolations,
  storageMigrationChecksum,
} from "../lib/storage-migration-policy.mjs";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

export function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function lockState(root = repositoryRoot) {
  const result = readStorageMigrationLock(root);
  if (!result) throw new Error("migrations.lock.json does not exist");
  const failures = storageMigrationLockMetadataViolations(result.entries);
  if (failures.length > 0) throw new Error(failures.join("\n"));
  return result;
}

export function stepRoot(id, root = repositoryRoot) {
  return resolve(root, STORAGE_MIGRATIONS_DIRECTORY, "steps", id);
}

export function setChecksum(entry, root = repositoryRoot) {
  entry.checksum = storageMigrationChecksum(stepRoot(entry.id, root));
}

export function formatPaths(paths, root = repositoryRoot) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, ["exec", "oxfmt", "--write", ...paths], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      result.stderr.trim() || `formatter exited ${result.status}`,
    );
}

export function formatStep(id, root = repositoryRoot) {
  formatPaths([stepRoot(id, root)], root);
}

export function appendRegistryEntry(file, id) {
  const symbol = `step${id.slice(0, 4)}`;
  const importLine = `import ${symbol} from "./${id}/step.js";`;
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    source = "";
  }
  if (source.includes(`"./${id}/step.js"`))
    throw new Error(`${id} is already registered`);
  if (!source) {
    source = `${importLine}\nimport type { MigrationStepV1 } from "../kit/define-step/v1.js";\n\nexport const STORAGE_MIGRATION_STEPS: readonly MigrationStepV1[] = Object.freeze([\n  ${symbol},\n]);\n`;
  } else {
    const marker =
      /(export const STORAGE_MIGRATION_STEPS[\s\S]*?Object\.freeze\(\[)([\s\S]*?)(\]\);)/;
    const match = marker.exec(source);
    if (!match)
      throw new Error(
        "steps/index.ts must export a STORAGE_MIGRATION_STEPS Object.freeze array",
      );
    const body = match[2].trim();
    const replacement = `${match[1]}\n  ${body ? `${body.replace(/,?$/, ",")}\n  ` : ""}${symbol},\n${match[3]}`;
    source = `${importLine}\n${source.replace(marker, replacement)}`;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}
