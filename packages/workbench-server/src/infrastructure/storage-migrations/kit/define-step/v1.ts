import type { DatabaseSync } from "node:sqlite";
import type { MigrationFilesV1 } from "../files/v1.js";
import type { MigrationRowsV1 } from "../rows/v1.js";

export type MigrationStepKindV1 = "schema" | "data" | "files" | "config";
export type MigrationRecordClassV1 = "derived" | "user-content";

/** Services supplied by the migration runner. Historical steps only depend on this contract. */
export interface MigrationContextV1 {
  readonly db: DatabaseSync;
  readonly rows: MigrationRowsV1;
  readonly files: MigrationFilesV1;
  /** Stable for the complete workspace run, and injectable in tests. */
  readonly nowMs: number;
}

export interface MigrationStepV1 {
  readonly id: `${string}`;
  readonly description: string;
  readonly kind: MigrationStepKindV1;
  readonly records?: MigrationRecordClassV1;
  run(context: MigrationContextV1): void | Promise<void>;
  verify?(context: MigrationContextV1): void | Promise<void>;
}

type StepInput = Omit<MigrationStepV1, "kind">;
type RecordStepInput = StepInput & {
  readonly records: MigrationRecordClassV1;
};

function freeze<T extends MigrationStepV1>(step: T): Readonly<T> {
  return Object.freeze(step);
}

export function defineSchemaStep(step: StepInput): MigrationStepV1 {
  return freeze({ ...step, kind: "schema" });
}

export function defineDataStep(step: RecordStepInput): MigrationStepV1 {
  return freeze({ ...step, kind: "data" });
}

export function defineFilesStep(step: RecordStepInput): MigrationStepV1 {
  return freeze({ ...step, kind: "files" });
}

export function defineConfigStep(step: RecordStepInput): MigrationStepV1 {
  return freeze({ ...step, kind: "config" });
}
