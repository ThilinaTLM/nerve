import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RegisteredStep } from "./step.js";

export type MigrationLock = Record<
  string,
  {
    checksum: string;
    stage: "draft" | "released";
    releasedIn?: string;
  }
>;

/** Hash names and bytes, in stable order, including every file in the step. */
export async function hashStepFolder(folder: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(relative: string): Promise<void> {
    const entries = await readdir(join(folder, relative), {
      withFileTypes: true,
    });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        const bytes = await readFile(join(folder, name));
        hash.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`);
        hash.update(bytes);
      } else
        throw new Error(`Migration folder contains non-regular file: ${name}`);
    }
  }
  await visit("");
  return hash.digest("hex");
}

export async function checkMigrationLock(
  stepsPath: string,
  registry: readonly RegisteredStep[],
  lock: MigrationLock,
): Promise<void> {
  const folders = (await readdir(stepsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const ids = registry.map(({ step }) => step.id);
  if (
    JSON.stringify(Object.keys(lock).sort()) !==
      JSON.stringify([...ids].sort()) ||
    JSON.stringify(folders) !== JSON.stringify([...ids].sort())
  ) {
    throw new Error("Migration registry, folders and lock IDs must match.");
  }
  for (const entry of registry) {
    const metadata = lock[entry.step.id];
    if (
      metadata.checksum !== entry.checksum ||
      metadata.stage !== entry.stage ||
      metadata.releasedIn !== entry.releasedIn
    ) {
      throw new Error(
        `Migration registry metadata differs from lock: ${entry.step.id}`,
      );
    }
    const checksum = await hashStepFolder(join(stepsPath, entry.step.id));
    if (metadata.stage === "released" && checksum !== metadata.checksum) {
      throw new Error(`Released migration changed: ${entry.step.id}`);
    }
  }
}
