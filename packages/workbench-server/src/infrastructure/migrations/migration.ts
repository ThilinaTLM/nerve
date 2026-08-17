import type { DatabaseSync } from "node:sqlite";
import type { StoragePaths } from "../storage/paths.js";

export type MigrationDetection = "current" | "pending";

export interface MigrationBackupSpec {
  /** Normalized POSIX-style identifiers relative to NERVE_HOME, not native filesystem paths. */
  paths: string[];
}

export interface MigrationContext {
  paths: StoragePaths;
  now(): Date;
  diagnostic(message: string): void;
  withDatabase<T>(operation: (database: DatabaseSync) => T): T;
  transaction<T>(operation: (database: DatabaseSync) => T): T;
}

export interface StorageMigration {
  id: string;
  description: string;
  /** SHA-256 of the immutable developer-maintained manifest string. */
  checksum: string;
  detect(context: MigrationContext): Promise<MigrationDetection>;
  backup(context: MigrationContext): Promise<MigrationBackupSpec>;
  up(context: MigrationContext): Promise<void>;
  verify(context: MigrationContext): Promise<void>;
}

export interface MigrationExecutionReport {
  id: string;
  execution: "ran" | "detected";
  durationMs: number;
}

export interface MigrationReport {
  durationMs: number;
  executions: MigrationExecutionReport[];
  backupBytes: number;
  archivePaths: string[];
}

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly migrationId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MigrationError";
  }
}
