import { AsyncResource } from "node:async_hooks";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const GIT_DIRECTORY_METADATA_MAX_BYTES = 8 * 1024;

async function metadataEntry(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Never read arbitrary devices/FIFOs or trust a size check against a later path open.
 * Nonblocking open prevents a regular-file -> FIFO replacement from hanging on POSIX.
 * The descriptor is checked again, and the read itself remains capped if it grows.
 */
async function readDirectoryMetadata(path: string): Promise<string> {
  const nonblocking = process.platform === "win32" ? 0 : constants.O_NONBLOCK;
  const file = await open(path, constants.O_RDONLY | nonblocking);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      !info.size ||
      info.size > GIT_DIRECTORY_METADATA_MAX_BYTES
    )
      throw new Error(
        "Git directory metadata must be a non-empty regular file of at most 8192 bytes",
      );
    const buffer = Buffer.alloc(GIT_DIRECTORY_METADATA_MAX_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const result = await file.read(
        buffer,
        bytes,
        buffer.length - bytes,
        bytes,
      );
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    if (!bytes || bytes > GIT_DIRECTORY_METADATA_MAX_BYTES)
      throw new Error(
        "Git directory metadata exceeds its byte limit or is empty",
      );
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      buffer.subarray(0, bytes),
    );
  } finally {
    await file.close();
  }
}

/** Linked worktrees share refs/object locks, so use common-dir, not worktree git-dir.
 * Returned paths remain actual filesystem paths; lane-key normalization is separate.
 */
export async function canonicalGitDirectory(cwd: string): Promise<string> {
  return (await canonicalGitIdentity(cwd)).commonDir;
}

export async function canonicalGitIdentity(
  cwd: string,
): Promise<{ gitDir: string; commonDir: string }> {
  let directory = await realpath(cwd);
  for (;;) {
    const marker = join(directory, ".git");
    const entry = await metadataEntry(marker);
    if (entry) {
      const info = entry.isSymbolicLink() ? await stat(marker) : entry;
      let gitDir = marker;
      if (!info.isDirectory()) {
        if (!info.isFile())
          throw new Error(
            "Git directory marker must be a directory or regular file",
          );
        const text = (await readDirectoryMetadata(marker)).trimEnd();
        if (
          !text.startsWith("gitdir: ") ||
          text.length === 8 ||
          text.includes("\0")
        )
          throw new Error("Invalid Git directory marker");
        gitDir = resolve(directory, text.slice(8));
      }
      const worktreeGitDir = await realpath(gitDir);
      const commonFile = join(worktreeGitDir, "commondir");
      let commonDir = worktreeGitDir;
      if (await metadataEntry(commonFile)) {
        const common = (await readDirectoryMetadata(commonFile)).trimEnd();
        if (!common || common.includes("\0"))
          throw new Error("Invalid common Git directory marker");
        commonDir = await realpath(resolve(worktreeGitDir, common));
      }
      return { gitDir: worktreeGitDir, commonDir };
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Not a Git repository");
    directory = parent;
  }
}

interface Entry {
  key: string;
  network: boolean;
  signal?: AbortSignal;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  abort: () => void;
}

/** FIFO per common Git directory; only lane heads compete for network permits. */
export class GitOperationLanes {
  readonly #queue: Entry[] = [];
  readonly #active = new Set<string>();
  #network = 0;

  constructor(
    readonly networkLimit = 4,
    readonly queueLimit = 256,
  ) {
    if (networkLimit < 1 || queueLimit < 1)
      throw new Error("Invalid Git lane limits");
  }

  run<T>(
    key: string,
    network: boolean,
    run: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted)
      return Promise.reject(signal.reason ?? new Error("Cancelled"));
    if (this.#queue.length >= this.queueLimit)
      return Promise.reject(new Error("Git operation queue is full"));
    return new Promise<T>((resolve, reject) => {
      const entry: Entry = {
        key,
        network,
        signal,
        // Draining can happen in another workflow's completion/abort context.
        // Preserve the submitter's repository identity and cancellation scope.
        run: AsyncResource.bind(run),
        resolve: (value) => resolve(value as T),
        reject,
        abort: () => {
          const index = this.#queue.indexOf(entry);
          if (index < 0) return;
          this.#queue.splice(index, 1);
          reject(signal?.reason ?? new Error("Cancelled"));
          this.#drain();
        },
      };
      signal?.addEventListener("abort", entry.abort, { once: true });
      this.#queue.push(entry);
      this.#drain();
    });
  }

  #drain(): void {
    const blocked = new Set<string>();
    for (let index = 0; index < this.#queue.length;) {
      const entry = this.#queue[index];
      if (
        blocked.has(entry.key) ||
        this.#active.has(entry.key) ||
        (entry.network && this.#network >= this.networkLimit)
      ) {
        blocked.add(entry.key);
        index++;
        continue;
      }
      this.#queue.splice(index, 1);
      entry.signal?.removeEventListener("abort", entry.abort);
      this.#active.add(entry.key);
      if (entry.network) this.#network++;
      void Promise.resolve()
        .then(entry.run)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.#active.delete(entry.key);
          if (entry.network) this.#network--;
          this.#drain();
        });
    }
  }
}

export const gitOperationLanes = new GitOperationLanes();
