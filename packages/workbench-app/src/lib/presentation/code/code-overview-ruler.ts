import { getSearchQuery } from "@codemirror/search";
import { type EditorState, Facet } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export type OverviewMarkKind =
  | "added"
  | "modified"
  | "deleted"
  | "search"
  | "target";

/** A document range to show in the overview ruler. Empty ranges (`from ===
 * to`) are drawn as a thin tick, for example where lines were removed. */
export type OverviewMark = { from: number; to: number; kind: OverviewMarkKind };

export type OverviewMarkSource = (
  state: EditorState,
) => readonly OverviewMark[];

/** Features register mark sources; the ruler collects them after document
 * changes and state effects, never on plain scrolling. */
export const overviewMarkSource = Facet.define<OverviewMarkSource>();

export type OverviewRow = {
  kind: OverviewMarkKind;
  top: number;
  height: number;
  /** Document position the row jumps to. */
  position: number;
};

const SEARCH_MARK_LIMIT = 2_000;
const MIN_ROW_HEIGHT = 2;
const CHANGE_KINDS = new Set<OverviewMarkKind>([
  "added",
  "modified",
  "deleted",
]);

export const searchOverviewMarks: OverviewMarkSource = (state) => {
  const query = getSearchQuery(state);
  if (!query.search || !query.valid) return [];
  const marks: OverviewMark[] = [];
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    marks.push({ from: next.value.from, to: next.value.to, kind: "search" });
    if (marks.length >= SEARCH_MARK_LIMIT) break;
  }
  return marks;
};

/**
 * Projects marks onto a ruler of `trackHeight` pixels and merges marks of the
 * same kind that overlap after rounding, so the row count is bounded by the
 * ruler height rather than the number of marks.
 */
export function overviewRows(
  marks: readonly OverviewMark[],
  geometry: {
    trackHeight: number;
    scrollHeight: number;
    blockTop: (position: number) => number;
    blockBottom: (position: number) => number;
  },
): OverviewRow[] {
  const { trackHeight, scrollHeight } = geometry;
  if (!marks.length || trackHeight <= 0 || scrollHeight <= 0) return [];
  const scale = trackHeight / Math.max(scrollHeight, trackHeight);
  const rows: OverviewRow[] = [];
  const lastByKind = new Map<OverviewMarkKind, OverviewRow>();
  const sorted = [...marks].sort((a, b) => a.from - b.from);
  for (const mark of sorted) {
    const top = Math.floor(geometry.blockTop(mark.from) * scale);
    const bottom =
      mark.to > mark.from
        ? Math.ceil(geometry.blockBottom(mark.to) * scale)
        : top;
    const height = Math.max(bottom - top, MIN_ROW_HEIGHT);
    const previous = lastByKind.get(mark.kind);
    if (previous && top <= previous.top + previous.height) {
      previous.height = Math.max(previous.height, top + height - previous.top);
      continue;
    }
    const row = { kind: mark.kind, top, height, position: mark.from };
    rows.push(row);
    lastByKind.set(mark.kind, row);
  }
  return rows;
}

type Measurement = {
  host: HTMLElement;
  top: number;
  height: number;
  rows: OverviewRow[];
};

/** The element that scrolls the document: the editor's own scroller, or the
 * shared container of a side-by-side merge view. */
function scrollContainer(view: EditorView): HTMLElement {
  const merge = view.dom.closest<HTMLElement>(".cm-mergeView");
  return merge ?? view.scrollDOM;
}

class OverviewRuler {
  readonly dom: HTMLElement;
  #marks: OverviewMark[] = [];
  #view: EditorView;

  constructor(view: EditorView) {
    this.#view = view;
    this.dom = document.createElement("div");
    this.dom.className = "cm-overview-ruler";
    this.dom.style.cssText = RULER_STYLE;
    this.dom.setAttribute("aria-hidden", "true");
    this.dom.addEventListener("mousedown", this.#onMouseDown);
    this.#collect(view.state);
    this.#schedule();
  }

  update(update: ViewUpdate): void {
    const sourcesChanged =
      update.startState.facet(overviewMarkSource) !==
      update.state.facet(overviewMarkSource);
    const marksMayChange =
      sourcesChanged ||
      update.docChanged ||
      update.transactions.some((transaction) => transaction.effects.length > 0);
    if (marksMayChange) this.#collect(update.state);
    if (marksMayChange || update.geometryChanged || update.heightChanged)
      this.#schedule();
  }

  destroy(): void {
    this.dom.removeEventListener("mousedown", this.#onMouseDown);
    this.dom.remove();
  }

  #collect(state: EditorState): void {
    this.#marks = state
      .facet(overviewMarkSource)
      .flatMap((source) => source(state));
  }

  #schedule(): void {
    this.#view.requestMeasure<Measurement>({
      key: this,
      read: (view) => {
        const scroller = scrollContainer(view);
        const host =
          scroller === view.scrollDOM
            ? view.dom
            : (scroller.parentElement ?? view.dom);
        // Offset of the document's first line inside the scrolled content.
        const documentOffset =
          view.documentTop -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop;
        return {
          host,
          top: scroller.offsetTop,
          height: scroller.clientHeight,
          rows: overviewRows(this.#marks, {
            trackHeight: scroller.clientHeight,
            scrollHeight: scroller.scrollHeight,
            blockTop: (position) =>
              view.lineBlockAt(position).top + documentOffset,
            blockBottom: (position) =>
              view.lineBlockAt(position).bottom + documentOffset,
          }),
        };
      },
      write: (measurement) => this.#render(measurement),
    });
  }

  #render({ host, top, height, rows }: Measurement): void {
    if (this.dom.parentElement !== host) host.appendChild(this.dom);
    this.dom.style.top = `${top}px`;
    this.dom.style.height = `${height}px`;
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const mark = document.createElement("div");
      mark.className = `cm-overview-mark cm-overview-${row.kind}`;
      mark.style.cssText = `position:absolute;pointer-events:auto;cursor:pointer;border-radius:1px;width:3px;left:${
        CHANGE_KINDS.has(row.kind) ? 1 : 4
      }px;top:${row.top}px;height:${row.height}px;background-color:${MARK_COLORS[row.kind]};`;
      mark.dataset.position = String(row.position);
      fragment.appendChild(mark);
    }
    this.dom.replaceChildren(fragment);
  }

  #onMouseDown = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.dataset.position) return;
    event.preventDefault();
    const position = Math.min(
      Number(target.dataset.position),
      this.#view.state.doc.length,
    );
    this.#view.dispatch({
      effects: EditorView.scrollIntoView(position, { y: "center" }),
    });
  };
}

/* The ruler can sit outside the editor element (split diffs), where
 * editor-scoped theme rules don't reach, so it is styled inline. Changes take
 * the left half of the lane; search matches and the target line the right. */
const RULER_STYLE =
  "position:absolute;right:0;width:8px;z-index:2;pointer-events:none;";
const MARK_COLORS: Record<OverviewMarkKind, string> = {
  added: "var(--success)",
  modified: "var(--info)",
  deleted: "var(--destructive-solid)",
  search: "var(--warning)",
  target: "var(--primary)",
};

/** A thin lane over the vertical scrollbar that shows where changes, search
 * matches and the target line are. It shows no text, so its cost depends on
 * the number of marks, not the size of the document. */
export const overviewRuler = ViewPlugin.define(
  (view) => new OverviewRuler(view),
);
