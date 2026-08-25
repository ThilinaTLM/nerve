import type { DatabaseSync } from "node:sqlite";

export interface CanonicalMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly backupPaths: readonly string[];
  apply(database: DatabaseSync): void;
  cleanup(home: string): Promise<void>;
  verify(database: DatabaseSync): void;
}
