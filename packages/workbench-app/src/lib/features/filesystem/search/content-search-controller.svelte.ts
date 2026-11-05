import type { FilesystemProjectContentSearchResponse } from "@nervekit/contracts/filesystem";
import { searchProjectContent } from "../api/filesystem.api";
import {
  searchPatternError,
  type SearchPatternError,
} from "./content-search-error";
import { parseGlobList } from "./content-search-results";

const SEARCH_DEBOUNCE_MS = 300;
const MAX_RESULTS = 1_000;

export type ContentSearchStatus = "idle" | "searching" | "done" | "error";

/** Project-wide "search in files" state. A sequence number discards responses
 * from superseded requests, so only the latest query ever renders. */
class ContentSearchController {
  query = $state("");
  regex = $state(false);
  caseSensitive = $state(false);
  wholeWord = $state(false);
  includeIgnored = $state(false);
  include = $state("");
  exclude = $state("");
  showFilters = $state(false);
  status = $state<ContentSearchStatus>("idle");
  response = $state.raw<FilesystemProjectContentSearchResponse>();
  /** The projectId the current `response` belongs to. */
  resultProjectId = $state<string>();
  error = $state<string>();
  /** The query is not a valid pattern; shown inline under the field. */
  patternError = $state<SearchPatternError>();
  /** Bumped by the focus shortcut; the panel focuses its field on change. */
  focusToken = $state(0);
  handledFocusToken = 0;

  #sequence = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  requestFocus(prefill?: string): void {
    if (prefill) this.query = prefill;
    this.focusToken += 1;
  }

  /** Re-runs after any input change (debounced) or immediately on Enter. */
  schedule(projectId: string | undefined, immediate = false): void {
    clearTimeout(this.#timer);
    this.patternError = undefined;
    this.#timer = setTimeout(
      () => void this.run(projectId),
      immediate ? 0 : SEARCH_DEBOUNCE_MS,
    );
  }

  clear(): void {
    this.#sequence += 1;
    clearTimeout(this.#timer);
    this.query = "";
    this.response = undefined;
    this.error = undefined;
    this.patternError = undefined;
    this.status = "idle";
  }

  async run(projectId: string | undefined): Promise<void> {
    const query = this.query;
    const sequence = ++this.#sequence;
    if (!projectId || query.trim() === "") {
      this.response = undefined;
      this.error = undefined;
      this.status = "idle";
      return;
    }
    this.status = "searching";
    this.patternError = undefined;
    try {
      const response = await searchProjectContent({
        projectId,
        query,
        regex: this.regex || undefined,
        caseSensitive: this.caseSensitive || undefined,
        wholeWord: this.wholeWord || undefined,
        include: parseGlobList(this.include),
        exclude: parseGlobList(this.exclude),
        includeIgnored: this.includeIgnored || undefined,
        maxResults: MAX_RESULTS,
      });
      if (sequence !== this.#sequence) return;
      this.response = response;
      this.resultProjectId = projectId;
      this.error = undefined;
      this.status = "done";
    } catch (caught) {
      if (sequence !== this.#sequence) return;
      const pattern = searchPatternError(caught);
      if (pattern) {
        this.response = undefined;
        this.error = undefined;
        this.patternError = pattern;
        this.status = "idle";
        return;
      }
      this.response = undefined;
      this.error = caught instanceof Error ? caught.message : String(caught);
      this.status = "error";
    }
  }
}

export const contentSearch = new ContentSearchController();
