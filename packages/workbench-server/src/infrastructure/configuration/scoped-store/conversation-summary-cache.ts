import { readFile } from "node:fs/promises";
import {
  atomicWriteFile,
  withFileMutation,
} from "../../storage-bootstrap/file-mutations.js";
import { freezeJson } from "./scoped-document-store.js";

export interface SummaryDocument<T> {
  schemaVersion: 1;
  entries: Record<string, T>;
}

/** Display-only projection. Never pass these entries to execution/configuration resolution. */
export class ConversationSummaryCache<T> {
  private entries = new Map<string, T>();
  private loaded = false;
  private mutations = 0;
  private dirty = false;
  private flushing: Promise<boolean> | undefined;

  constructor(
    private readonly options: {
      path: string;
      /** Supplied by the domain contracts, including strict envelope/entry validation. */
      parse(input: unknown): SummaryDocument<T>;
      write?: typeof atomicWriteFile;
    },
  ) {}

  async load(): Promise<void> {
    await withFileMutation(
      `${this.options.path}.summary-load-lock`,
      async () => {
        if (this.loaded) return;
        const startedAt = this.mutations;
        try {
          const document = this.options.parse(
            JSON.parse(await readFile(this.options.path, "utf8")),
          );
          // Do not replace entries updated while the disposable disk read was in flight.
          for (const [id, entry] of Object.entries(document.entries)) {
            if (
              !this.entries.has(id) &&
              startedAt === this.mutations &&
              this.mutations === 0
            )
              this.entries.set(id, freezeJson(structuredClone(entry)));
          }
        } catch {
          /* Missing, corrupt, future-version and unreadable cache all mean empty. */
        }
        this.loaded = true;
      },
    );
  }

  get(conversationId: string): Readonly<T> | undefined {
    return this.entries.get(conversationId);
  }

  set(conversationId: string, summary: T): void {
    // Validate before storing, not just when loading from disk.
    const parsed = this.options.parse({
      schemaVersion: 1,
      entries: { [conversationId]: summary },
    });
    const entry = parsed.entries[conversationId];
    if (entry === undefined) throw new Error("Summary parser removed entry");
    this.mutations += 1;
    this.entries.set(conversationId, freezeJson(structuredClone(entry)));
    this.dirty = true;
  }

  remove(conversationId: string): void {
    this.mutations += 1;
    this.entries.delete(conversationId);
    this.dirty = true;
  }

  /** Explicit recoverable work after activation/ack; batches all changes in the same turn.
   * False means disposable persistence failed; configuration saves must not await this as authority.
   */
  flush(): Promise<boolean> {
    if (this.flushing) return this.flushing;
    this.flushing = Promise.resolve().then(async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          const document: SummaryDocument<T> = {
            schemaVersion: 1,
            entries: Object.fromEntries(this.entries),
          };
          try {
            await (this.options.write ?? atomicWriteFile)(
              this.options.path,
              `${JSON.stringify(document)}\n`,
              { mode: 0o600 },
            );
          } catch {
            this.dirty = true;
            return false;
          }
        }
        return true;
      } finally {
        this.flushing = undefined;
      }
    });
    return this.flushing;
  }
}
