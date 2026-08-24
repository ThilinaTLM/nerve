import { join } from "node:path";
import { atomicWriteJson, pathExists, readJsonFile } from "../storage/json.js";
import { assertCanonicalRelativePath } from "./canonical-path.js";
import { migrationChecksum } from "./checksum.js";
import type { StorageMigration } from "./migration.js";

export interface CanonicalJsonMigrationDefinition<T> {
  id: string;
  version: number;
  description: string;
  relativePath: string;
  readDefault(): T;
  canonicalize(value: unknown): T;
  verify(value: unknown): T;
}

export function defineCanonicalJsonMigration<T>(
  definition: CanonicalJsonMigrationDefinition<T>,
): StorageMigration {
  const relativePath = assertCanonicalRelativePath(definition.relativePath);
  const manifest = [
    definition.id,
    `v${definition.version}`,
    definition.description,
    relativePath,
  ].join("|");
  const file = (home: string) => join(home, ...relativePath.split("/"));
  const read = async (home: string): Promise<unknown> =>
    (await pathExists(file(home)))
      ? readJsonFile<unknown>(file(home))
      : definition.readDefault();

  return {
    id: definition.id,
    description: definition.description,
    checksum: migrationChecksum(manifest),
    async detect(context) {
      const raw = await read(context.paths.home);
      const canonical = definition.canonicalize(raw);
      return JSON.stringify(raw) === JSON.stringify(canonical)
        ? "current"
        : "pending";
    },
    async backup() {
      return { paths: [relativePath] };
    },
    async up(context) {
      const canonical = definition.canonicalize(await read(context.paths.home));
      await atomicWriteJson(file(context.paths.home), canonical, 0o600);
    },
    async verify(context) {
      const raw = await read(context.paths.home);
      const verified = definition.verify(raw);
      const canonical = definition.canonicalize(raw);
      if (
        JSON.stringify(raw) !== JSON.stringify(verified) ||
        JSON.stringify(raw) !== JSON.stringify(canonical)
      ) {
        throw new Error(
          `Canonical JSON migration '${definition.id}' did not produce canonical '${relativePath}'.`,
        );
      }
    },
  };
}
