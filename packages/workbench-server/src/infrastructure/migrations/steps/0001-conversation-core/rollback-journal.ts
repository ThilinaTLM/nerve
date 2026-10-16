import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

type JournalEntry =
  /**
   * A file's pre-step bytes (`backup`) or symbolic link target (`link`), or
   * its absence plus the parent directories the step created.
   */
  | {
      kind: "file";
      path: string;
      backup: string | null;
      link?: string;
      mode?: number;
      createdDirectories: string[];
    }
  /** A directory renamed by the step. */
  | { kind: "rename"; from: string; to: string }
  /** Entries of a directory before the step added new-layout children. */
  | { kind: "directory"; path: string; entries: string[] | null };

/**
 * Write-ahead record of every pre-existing location this step changes, so a
 * failed attempt can restore the 0.34.1 home. Entries are written before the
 * change and keep the first (original) state across retries.
 */
export class RollbackJournal {
  readonly #root: string;
  readonly #scratch: string;
  readonly #entries: JournalEntry[];
  readonly #known = new Set<string>();

  constructor(scratchDir: string) {
    this.#scratch = resolve(scratchDir);
    this.#root = join(this.#scratch, "rollback");
    mkdirSync(join(this.#root, "files"), { recursive: true, mode: 0o700 });
    this.#entries = existsSync(this.#index)
      ? (JSON.parse(readFileSync(this.#index, "utf8")) as JournalEntry[])
      : [];
    for (const entry of this.#entries) this.#known.add(key(entry));
  }

  get #index(): string {
    return join(this.#root, "journal.json");
  }

  /** Call before writing, replacing or removing a file outside the scratch dir. */
  preserveFile(path: string): void {
    path = resolve(path);
    const rel = relative(this.#scratch, path);
    if (!rel.startsWith("..") && !isAbsolute(rel)) return;
    if (this.#known.has(`file:${path}`)) return;
    let backup: string | null = null;
    let link: string | undefined;
    let mode: number | undefined;
    const createdDirectories: string[] = [];
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) link = readlinkSync(path);
    else if (stat) {
      assert(stat.isFile(), `Rollback can only preserve files: ${path}`);
      backup = join("files", String(this.#entries.length));
      mode = stat.mode & 0o777;
      copyFileSync(path, join(this.#root, backup));
    } else {
      for (
        let parent = dirname(path);
        !existsSync(parent) && parent !== dirname(parent);
        parent = dirname(parent)
      )
        createdDirectories.push(parent);
    }
    this.#append({
      kind: "file",
      path,
      backup,
      link,
      mode,
      createdDirectories,
    });
  }

  /** Call before renaming a directory. */
  recordRename(from: string, to: string): void {
    this.#append({ kind: "rename", from: resolve(from), to: resolve(to) });
  }

  /** Call before adding children to a directory; rollback removes new ones. */
  snapshotDirectory(path: string): void {
    path = resolve(path);
    if (this.#known.has(`directory:${path}`)) return;
    this.#append({
      kind: "directory",
      path,
      entries: existsSync(path) ? readdirSync(path).sort() : null,
    });
  }

  /** Undo journaled changes, newest first. Idempotent across interruptions. */
  restore(): void {
    for (const entry of [...this.#entries].reverse()) {
      if (entry.kind === "rename") {
        if (existsSync(entry.to) && !existsSync(entry.from))
          renameSync(entry.to, entry.from);
      } else if (entry.kind === "directory") {
        if (!existsSync(entry.path)) continue;
        if (entry.entries === null) {
          rmSync(entry.path, { recursive: true, force: true });
          continue;
        }
        const original = new Set(entry.entries);
        for (const name of readdirSync(entry.path))
          if (!original.has(name))
            rmSync(join(entry.path, name), { recursive: true, force: true });
      } else if (entry.link !== undefined) {
        if (lstatSync(entry.path, { throwIfNoEntry: false })?.isSymbolicLink())
          continue;
        rmSync(entry.path, { force: true });
        mkdirSync(dirname(entry.path), { recursive: true });
        symlinkSync(entry.link, entry.path);
      } else if (entry.backup) {
        mkdirSync(dirname(entry.path), { recursive: true });
        const temporary = `${entry.path}.rollback`;
        copyFileSync(join(this.#root, entry.backup), temporary);
        if (entry.mode !== undefined) chmodSync(temporary, entry.mode);
        renameSync(temporary, entry.path);
      } else {
        rmSync(entry.path, { force: true });
        for (const directory of entry.createdDirectories) {
          try {
            rmdirSync(directory);
          } catch {
            // Not empty: something else now lives there.
          }
        }
      }
    }
  }

  #append(entry: JournalEntry): void {
    if (this.#known.has(key(entry))) return;
    this.#entries.push(entry);
    this.#known.add(key(entry));
    const temporary = `${this.#index}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.#entries), { mode: 0o600 });
    renameSync(temporary, this.#index);
  }
}

function key(entry: JournalEntry): string {
  return entry.kind === "rename"
    ? `rename:${entry.from}`
    : `${entry.kind}:${entry.path}`;
}

let active: RollbackJournal | undefined;

/** Run `action` with every conversion helper journaling into `journal`. */
export async function withRollbackJournal<T>(
  journal: RollbackJournal,
  action: () => Promise<T>,
): Promise<T> {
  active = journal;
  try {
    return await action();
  } finally {
    active = undefined;
  }
}

/** No-op outside a migration attempt (e.g. the runtime project.create move). */
export function preserveForRollback(path: string): void {
  active?.preserveFile(path);
}
