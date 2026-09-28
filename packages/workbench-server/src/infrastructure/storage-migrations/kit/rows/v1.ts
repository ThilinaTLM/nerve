import type { JsonObjectV1 } from "../json/v1.js";

export interface MigrationDocumentV1<T extends JsonObjectV1 = JsonObjectV1> {
  readonly namespace: string;
  readonly scopeId: string;
  readonly documentId: string;
  readonly revision: number;
  readonly payloadVersion: number;
  readonly data: T;
}

export interface MigrationDocumentWriteV1 {
  /** Shallow-merges fields while preserving fields unknown to the historical step. */
  merge(patch: JsonObjectV1): void;
  replace(data: JsonObjectV1, payloadVersion?: number): void;
}

export type DocumentShapeV1<T extends JsonObjectV1> = (value: unknown) => T;

/**
 * The runner implements batching, a savepoint per record, and quarantine on a
 * callback failure. Steps must not open transactions inside these callbacks.
 */
export interface MigrationRowsV1 {
  eachDocument<T extends JsonObjectV1>(
    namespace: string,
    shape: DocumentShapeV1<T>,
    visit: (
      row: MigrationDocumentV1<T>,
      write: MigrationDocumentWriteV1,
    ) => void | Promise<void>,
    options?: { readonly scopeId?: string; readonly batchSize?: number },
  ): Promise<void>;
}
