import {
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import {
  isSearchQueryValid,
  searchMatchStatus,
  selectedSearchText,
} from "./code-viewer-helpers";

export type FindOption = "case" | "word" | "regexp";

/** The find field is one line: line breaks in a seeded selection become the
 * `\n` escapes CodeMirror's search understands (backslashes are escaped so
 * they stay literal in plain-text mode). */
export function searchFieldText(selection: string, regexp: boolean): string {
  const escaped = regexp ? selection : selection.replace(/\\/g, "\\\\");
  return escaped.replace(/\r?\n/g, "\\n");
}

/** Find/replace state for one code view. Match counting only runs while the
 * panel is open and is coalesced to one pass per animation frame. */
export class CodeFindController {
  open = $state(false);
  replaceOpen = $state(false);
  query = $state("");
  replacement = $state("");
  caseSensitive = $state(false);
  wholeWord = $state(false);
  regexp = $state(false);
  status = $state("0 results");
  valid = $state(true);
  /** Bumped to ask the panel to focus and select its find field. */
  focusRequest = $state(0);

  #view: () => EditorView | undefined;
  #frame: number | undefined;

  constructor(view: () => EditorView | undefined) {
    this.#view = view;
  }

  searchQuery(): SearchQuery {
    return new SearchQuery({
      search: this.query,
      replace: this.replacement,
      caseSensitive: this.caseSensitive,
      wholeWord: this.wholeWord,
      regexp: this.regexp,
    });
  }

  /** Re-counts matches after the document or selection changes. */
  scheduleRefresh(): void {
    if (!this.open || this.#frame !== undefined) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = undefined;
      this.#updateStatus();
    });
  }

  setQuery(value: string): void {
    this.query = value;
    this.#apply();
  }

  setReplacement(value: string): void {
    this.replacement = value;
    this.#apply();
  }

  setOption(option: FindOption, value: boolean): void {
    if (option === "case") this.caseSensitive = value;
    else if (option === "word") this.wholeWord = value;
    else this.regexp = value;
    this.#apply();
  }

  show(options: { seed?: boolean; position?: number; replace?: boolean }) {
    const view = this.#view();
    if (!view) return;
    const selected =
      options.seed === false
        ? undefined
        : selectedSearchText(view.state, options.position);
    if (selected) this.query = searchFieldText(selected, this.regexp);
    if (options.replace !== undefined) this.replaceOpen = options.replace;
    this.open = true;
    this.focusRequest += 1;
    this.#apply();
  }

  close(): void {
    this.open = false;
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
    const view = this.#view();
    view?.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "" })),
    });
    requestAnimationFrame(() => view?.focus());
  }

  next(): void {
    this.#run(findNext);
  }

  previous(): void {
    this.#run(findPrevious);
  }

  replaceNext(): void {
    this.#run(replaceNext);
  }

  replaceAll(): void {
    this.#run(replaceAll);
  }

  dispose(): void {
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
  }

  #run(command: (view: EditorView) => boolean): void {
    const view = this.#view();
    if (!view || !this.query || !this.searchQuery().valid) return;
    // Commands read the query from editor state; make sure it is current
    // even when the panel was reopened without edits.
    view.dispatch({ effects: setSearchQuery.of(this.searchQuery()) });
    command(view);
    this.#updateStatus();
  }

  #apply(): void {
    const view = this.#view();
    if (!view) return;
    view.dispatch({ effects: setSearchQuery.of(this.searchQuery()) });
    this.#updateStatus();
  }

  #updateStatus(): void {
    const view = this.#view();
    if (!view) return;
    const query = this.searchQuery();
    this.valid = isSearchQueryValid(query);
    if (!query.search) {
      this.status = "No results";
      return;
    }
    const status = searchMatchStatus(view.state, query);
    const total = status.capped ? `${status.count}+` : `${status.count}`;
    if (status.current) this.status = `${status.current} of ${total}`;
    else if (status.count === 0) this.status = "No results";
    else this.status = `${total} results`;
  }
}
