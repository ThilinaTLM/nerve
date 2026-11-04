import type { FilesystemProjectPathMatch } from "@nervekit/contracts/filesystem";
import { searchProjectPaths } from "../api/filesystem.api";
import { parseQuickOpenQuery } from "./quick-open-query";

const SEARCH_DEBOUNCE_MS = 90;
const INDEXING_RETRY_MS = 900;
const MAX_INDEXING_RETRIES = 20;
const RESULT_LIMIT = 50;

/** Quick-open dialog state. Requests are sequence-numbered so a slow response
 * for an older query can never replace newer results. */
class QuickOpenController {
  open = $state(false);
  query = $state("");
  matches = $state<FilesystemProjectPathMatch[]>([]);
  incomplete = $state(false);
  loading = $state(false);
  error = $state<string>();

  #sequence = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #retries = 0;
  #projectId: string | undefined;

  show(projectId: string | undefined, initialQuery = ""): void {
    this.#projectId = projectId;
    this.query = initialQuery;
    this.open = true;
    this.schedule(0);
  }

  close(): void {
    this.open = false;
    this.#cancel();
    this.matches = [];
    this.error = undefined;
    this.incomplete = false;
    this.loading = false;
  }

  setQuery(query: string): void {
    this.query = query;
    this.#retries = 0;
    this.schedule(SEARCH_DEBOUNCE_MS);
  }

  /** The query without a trailing `:line`. */
  get parsed() {
    return parseQuickOpenQuery(this.query);
  }

  schedule(delay: number): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#run(), delay);
  }

  #cancel(): void {
    this.#sequence += 1;
    clearTimeout(this.#timer);
  }

  async #run(): Promise<void> {
    const projectId = this.#projectId;
    const { query } = this.parsed;
    const sequence = ++this.#sequence;
    if (!projectId || !query) {
      this.matches = [];
      this.incomplete = false;
      this.loading = false;
      this.error = undefined;
      return;
    }
    this.loading = true;
    try {
      const response = await searchProjectPaths({
        projectId,
        query,
        limit: RESULT_LIMIT,
        kinds: ["file"],
      });
      if (sequence !== this.#sequence) return;
      this.matches = response.matches;
      this.incomplete = response.incomplete;
      this.error = undefined;
      if (response.incomplete && this.#retries < MAX_INDEXING_RETRIES) {
        this.#retries += 1;
        this.schedule(INDEXING_RETRY_MS);
      }
    } catch (caught) {
      if (sequence !== this.#sequence) return;
      this.matches = [];
      this.incomplete = false;
      this.error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (sequence === this.#sequence) this.loading = false;
    }
  }
}

export const quickOpen = new QuickOpenController();
