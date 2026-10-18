import { setImmediate } from "node:timers/promises";
import { binding } from "../binding/loader.js";
import { acquireBuildSlot } from "./admission.js";
import type {
  NativeCompletionQuery,
  NativeSearchDocument,
  NativeFileCompletionIndexHandle,
} from "./binding.js";
import type { SearchIndex, SearchQuery } from "./contracts.js";
import { createLane } from "./lane.js";
import { compactField, caseAlignment } from "./normalize.js";

import {
  MAX_UNITS,
  MAX_CHANGES,
  MAX_FIELDS,
  MAX_RECORDS,
  validateUpdate,
  captureUpdate,
} from "./budget.js";

function query(input: SearchQuery): NativeCompletionQuery {
  if (typeof input.text !== "string" || input.text.length > 4096)
    throw new RangeError("Search query exceeds 4096 UTF-16 units");
  const value = input.text.trim().replaceAll("\\", "/");
  const terms = value
    .replace(/\/+$/, "")
    .split(/[\s/]+/)
    .filter(Boolean);
  if (terms.length > 32) throw new RangeError("Search query exceeds 32 terms");
  const lower = value.toLowerCase();
  return {
    value,
    lower,
    aligned: caseAlignment(value, lower)?.aligned,
    path: lower.replace(/\/+$/, ""),
    folder: value.endsWith("/"),
    ordered: value.includes("/"),
    terms: terms.map((t) => {
      const lower = t.toLowerCase();
      return { value: t, lower, aligned: caseAlignment(t, lower)?.aligned };
    }),
  };
}

/** One project-owned, in-memory lexical index. No provider policy or persistence. */
export async function createSearchIndex(
  options: { signal?: AbortSignal } = {},
): Promise<SearchIndex> {
  options.signal?.throwIfAborted();
  return wrapSearchIndex(new binding.NativeFileCompletionIndex(), options);
}

/** Internal facade seam for owning lifecycle/failure tests; not a package-root export. */
export function wrapSearchIndex(
  handle: NativeFileCompletionIndexHandle,
  options: { signal?: AbortSignal } = {},
): SearchIndex {
  options.signal?.throwIfAborted();
  const lane = createLane(handle);
  let reservedUnits = 0,
    reservedChanges = 0,
    reservedFields = 0,
    reservedRecords = 0;
  const close = () => {
    options.signal?.removeEventListener("abort", abort);
    return lane.close();
  };
  const abort = () => {
    void close().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  return {
    async update(input) {
      lane.capacity();
      const budget = validateUpdate(input);
      if (reservedUnits + budget.units > MAX_UNITS)
        throw new RangeError(
          "Search queued update source exceeds 64Mi UTF-16 units",
        );
      if (reservedChanges + budget.changes > MAX_CHANGES)
        throw new RangeError("Search queued update count exceeds 400000");
      if (
        reservedFields + budget.fields > MAX_FIELDS ||
        reservedRecords + budget.records > MAX_RECORDS
      )
        throw new RangeError("Search queued update structural budget exceeded");
      const captured = captureUpdate(input);
      reservedUnits += budget.units;
      reservedChanges += budget.changes;
      reservedFields += budget.fields;
      reservedRecords += budget.records;
      try {
        return await lane.run(async () => {
          const release = await acquireBuildSlot(lane.signal);
          try {
            lane.check();
            const batch: NativeSearchDocument[] = [];
            let batchUnits = 0;
            const flush = async () => {
              if (batch.length) {
                await handle.stage(batch, []);
                batch.length = 0;
                batchUnits = 0;
              }
              await setImmediate();
              lane.check();
            };
            for (const document of captured.upsert) {
              const units =
                document.id.length +
                document.kind.length +
                document.fields.reduce((n, f) => n + f.text.length, 0);
              if (
                batch.length &&
                (batch.length >= 1024 || batchUnits + units > 65536)
              )
                await flush();
              batch.push({
                id: document.id,
                kind: document.kind,
                fields: document.fields.map(compactField),
              });
              batchUnits += units;
            }
            await flush();
            for (let i = 0; i < captured.remove.length; i += 1024) {
              await handle.stage([], captured.remove.slice(i, i + 1024));
              await setImmediate();
              lane.check();
            }
            return { revision: await handle.commit() };
          } catch (error) {
            // A failed batch never publishes; clear staged native data before the next lane request.
            try {
              await handle.discard();
            } catch {
              /* Close already owns disposal. */
            }
            throw error;
          } finally {
            release();
          }
        });
      } finally {
        reservedUnits -= budget.units;
        reservedChanges -= budget.changes;
        reservedFields -= budget.fields;
        reservedRecords -= budget.records;
      }
    },
    async query(input) {
      lane.check();
      const limit = input.limit ?? 64;
      if (!Number.isInteger(limit) || limit < 0 || limit > 256)
        throw new RangeError("Search limit must be an integer from 0 to 256");
      if (
        input.kinds !== undefined &&
        (!Array.isArray(input.kinds) ||
          input.kinds.length > 256 ||
          input.kinds.some(
            (kind) =>
              typeof kind !== "string" || !kind.length || kind.length > 128,
          ))
      )
        throw new TypeError("Invalid search kinds");
      let documentIds: string[] | undefined;
      const ids = input.documentIds;
      if (ids !== undefined) {
        if (!Array.isArray(ids))
          throw new TypeError("Invalid search documentIds array");
        const count = ids.length;
        if (!Number.isInteger(count) || count < 0 || count > 256)
          throw new RangeError(
            "Search documentIds must contain at most 256 IDs",
          );
        documentIds = [];
        for (let i = 0; i < count; i++) {
          const id = ids[i];
          if (typeof id !== "string" || !id.length || id.length > 1024)
            throw new TypeError("Invalid search documentIds entry");
          documentIds.push(id);
        }
      }
      const prepared = query(input);
      const kinds = input.kinds?.slice();
      return lane.run(() => handle.search(prepared, kinds, limit, documentIds));
    },
    close,
  };
}
