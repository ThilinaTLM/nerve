import { isAbsolute } from "node:path";
import { setImmediate } from "node:timers/promises";
import { binding } from "../binding/loader.js";

export interface FileCompletionCandidateInput {
  relativePath: string;
  name: string;
  stem: string;
  segments: readonly string[];
  depth: number;
  kind: "file" | "directory";
}
export interface FileCompletionMatch {
  candidateIndex: number;
  score: number;
  matchRanges: [number, number][];
}
export interface FileCompletionIndex {
  query(
    rawQuery: string,
    options?: { limit?: number },
  ): Promise<FileCompletionMatch[]>;
  close(): Promise<void>;
}
// Private addon DTOs: napi Utf16String preserves even unpaired JS surrogates.
export interface NativeCompletionCandidate {
  path: string;
  name: string;
  stem: string;
  pathLower: string;
  nameLower: string;
  stemLower: string;
  segments: string[];
  segmentsLower: string[];
  depth: number;
  directory: boolean;
  localeRank: number;
}
export interface NativeCompletionQuery {
  value: string;
  lower: string;
  path: string;
  folder: boolean;
  ordered: boolean;
  terms: { value: string; lower: string }[];
}
export interface NativeFileCompletionIndexHandle {
  build(candidates: NativeCompletionCandidate[]): Promise<void>;
  query(
    query: NativeCompletionQuery,
    limit: number,
  ): Promise<FileCompletionMatch[]>;
  close(): Promise<void>;
}
// Admission covers cold JS preparation, append tasks, and failure disposal.
let activeBuilds = 0;
const waitingBuilds: { enter(): void }[] = [];
async function acquireBuildSlot(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted();
  if (activeBuilds >= 2 && waitingBuilds.length >= 16)
    throw new Error("Completion build queue is full");
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = waitingBuilds.indexOf(request);
      if (index >= 0) waitingBuilds.splice(index, 1);
      reject(signal?.reason ?? new Error("Completion build aborted"));
    };
    const request = {
      enter() {
        signal?.removeEventListener("abort", abort);
        activeBuilds++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          activeBuilds--;
          waitingBuilds.shift()?.enter();
        });
      },
    };
    if (activeBuilds < 2) request.enter();
    else {
      waitingBuilds.push(request);
      signal?.addEventListener("abort", abort, { once: true });
    }
  });
}
const MAX_CANDIDATES = 1_000_000;
const MAX_SOURCE_UNITS = 64 * 1024 * 1024;
function prepare(raw: string): NativeCompletionQuery | undefined {
  const value = raw.trim().replace(/^@+/, "").replaceAll("\\", "/");
  if (
    isAbsolute(value) ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//.test(value) ||
    value.split("/").includes("..")
  )
    return undefined;
  const ordered = value.includes("/");
  const lower = value.toLowerCase();
  return {
    value: value,
    lower: lower,
    path: lower.replace(/\/+$/, ""),
    folder: value.endsWith("/"),
    ordered,
    terms: value
      .replace(/\/+$/, "")
      .split(ordered ? /\/+/ : /\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ value: t, lower: t.toLowerCase() })),
  };
}
// Yield between bounded JS chunks: locale/casing remain owned by the host, but
// neither sorting nor N-API receives the entire large candidate graph at once.
async function localeRanks(
  candidates: readonly FileCompletionCandidateInput[],
  signal?: AbortSignal,
): Promise<Uint32Array> {
  const pause = async () => {
    await setImmediate();
    signal?.throwIfAborted();
  };
  const compare = (a: number, b: number) =>
    candidates[a]!.relativePath.localeCompare(candidates[b]!.relativePath);
  let order: number[] = [];
  for (let start = 0; start < candidates.length; start += 1024) {
    const chunk = Array.from(
      { length: Math.min(1024, candidates.length - start) },
      (_, i) => start + i,
    ).sort(compare);
    order.push(...chunk);
    await pause();
  }
  for (let width = 1024; width < order.length; width *= 2) {
    const merged = new Array<number>(order.length);
    for (let start = 0; start < order.length; start += width * 2) {
      const middle = Math.min(start + width, order.length),
        end = Math.min(start + width * 2, order.length);
      let left = start,
        right = middle;
      for (let at = start; at < end; at++) {
        merged[at] =
          right >= end ||
          (left < middle && compare(order[left]!, order[right]!) <= 0)
            ? order[left++]!
            : order[right++]!;
        if (at % 4096 === 0) await pause();
      }
    }
    order = merged;
  }
  const ranks = new Uint32Array(candidates.length);
  let rank = 0;
  for (let i = 0; i < order.length; i++) {
    if (i && compare(order[i - 1]!, order[i]!) !== 0) rank++;
    ranks[order[i]!] = rank;
    if (i % 4096 === 0) await pause();
  }
  return ranks;
}
/**
 * Cold build owns JS lowercasing and host localeCompare ranks. Retains no JS candidate
 * graph after build. No silent truncation: at most 1M candidates / 64Mi UTF-16 source
 * units (path+name+stem+segments). Synthesized directory candidates can make huge
 * or deep Git snapshots exceed these caps even within a 16MiB Git listing.
 * Preprocessing and N-API conversion are part of cold-build cost, not warm queries.
 */
export async function createFileCompletionIndex(
  candidates: readonly FileCompletionCandidateInput[],
  options: { signal?: AbortSignal } = {},
): Promise<FileCompletionIndex> {
  if (candidates.length > MAX_CANDIDATES)
    throw new RangeError("Completion candidate count exceeds 1000000");
  const release = await acquireBuildSlot(options.signal);
  try {
    return await buildFileCompletionIndex(candidates, options.signal);
  } finally {
    release();
  }
}

async function buildFileCompletionIndex(
  candidates: readonly FileCompletionCandidateInput[],
  signal?: AbortSignal,
): Promise<FileCompletionIndex> {
  signal?.throwIfAborted();
  let total = 0;
  for (let i = 0; i < candidates.length; i++) {
    if (i % 1024 === 0) {
      await setImmediate();
      signal?.throwIfAborted();
    }
    const c = candidates[i]!;
    if (
      !Number.isInteger(c.depth) ||
      c.depth < 0 ||
      c.depth > 0xffff_ffff ||
      c.name.length > c.relativePath.length ||
      (c.kind !== "file" && c.kind !== "directory")
    )
      throw new TypeError("Invalid completion candidate");
    total +=
      c.relativePath.length +
      c.name.length +
      c.stem.length +
      c.segments.reduce((n, s) => n + s.length, 0);
    if (total > MAX_SOURCE_UNITS)
      throw new RangeError(
        "Completion candidate source exceeds 64Mi UTF-16 units",
      );
  }
  const handle = new binding.NativeFileCompletionIndex();
  let disposal: Promise<void> | undefined;
  const dispose = () => (disposal ??= handle.close());
  const abort = () => {
    void dispose().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    // Stable ranks, with equal rank for locale-equivalent paths. Input order is
    // Rust's final tie break, matching JS's stable sort exactly.
    const ranks = await localeRanks(candidates, signal);
    const batch: NativeCompletionCandidate[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (i % 1024 === 0) {
        await setImmediate();
        signal?.throwIfAborted();
      }
      const c = candidates[i]!;
      batch.push({
        path: c.relativePath,
        name: c.name,
        stem: c.stem,
        pathLower: c.relativePath.toLowerCase(),
        nameLower: c.name.toLowerCase(),
        stemLower: c.stem.toLowerCase(),
        segments: [...c.segments],
        segmentsLower: c.segments.map((s) => s.toLowerCase()),
        depth: c.depth,
        directory: c.kind === "directory",
        localeRank: ranks[i]!,
      });
      if (batch.length === 1024) {
        await handle.build(batch);
        batch.length = 0;
      }
    }
    if (batch.length || candidates.length === 0) await handle.build(batch);
    signal?.throwIfAborted();
  } catch (error) {
    await dispose();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  return wrapIndex(handle);
}

// Separate closure scope: never retain cold-build candidates/batch through query methods.
function wrapIndex(
  handle: NativeFileCompletionIndexHandle,
): FileCompletionIndex {
  let closed = false;
  let closing: Promise<void> | undefined;
  type Request = {
    query: NativeCompletionQuery;
    limit: number;
    resolve: (matches: FileCompletionMatch[]) => void;
    reject: (error: unknown) => void;
  };
  const queue: Request[] = [];
  let active: Promise<void> | undefined;
  function pump(): void {
    if (closed || active || !queue.length) return;
    const request = queue.shift()!;
    active = (async () => {
      try {
        request.resolve(await handle.query(request.query, request.limit));
      } catch (error) {
        request.reject(error);
      }
    })().finally(() => {
      active = undefined;
      pump();
    });
  }
  return {
    async query(raw, queryOptions = {}) {
      if (closed) throw new Error("Completion index is closed");
      if (raw.length > 4096)
        throw new RangeError("Completion query exceeds 4096 UTF-16 units");
      const limit = queryOptions.limit ?? 8;
      if (!Number.isInteger(limit) || limit < 0 || limit > 8)
        throw new RangeError("Completion limit must be an integer from 0 to 8");
      if (queue.length >= 32) throw new Error("Completion index queue is full");
      const query = prepare(raw);
      if (!query || limit === 0) return [];
      return new Promise<FileCompletionMatch[]>((resolve, reject) => {
        queue.push({ query, limit, resolve, reject });
        pump();
      });
    },
    async close() {
      if (!closing) {
        closed = true;
        const disposal = handle.close();
        for (const request of queue.splice(0))
          request.reject(new Error("Completion index is closed"));
        closing = Promise.all([disposal, active]).then(() => undefined);
      }
      await closing;
    },
  };
}
