import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const QUOTE = /^( {0,3}>[ \t]?)+/;

/** Blockquote lines (`> …`) outside fenced code, with their marker spans. */
export function findQuoteLines(
  text: string,
): Array<{ line: number; markerLength: number }> {
  const quotes: Array<{ line: number; markerLength: number }> = [];
  let fence: string | undefined;
  text.split("\n").forEach((line, index) => {
    const fenceMatch = line.match(FENCE)?.[1];
    if (fenceMatch) {
      if (!fence) fence = fenceMatch;
      else if (fenceMatch[0] === fence[0] && fenceMatch.length >= fence.length)
        fence = undefined;
      return;
    }
    if (fence) return;
    const marker = line.match(QUOTE)?.[0];
    if (marker) quotes.push({ line: index + 1, markerLength: marker.length });
  });
  return quotes;
}

const lineDecoration = Decoration.line({ class: "cm-quote-block-line" });
/** The `>` markers stay in the text but are hidden behind the quote styling. */
const markerDecoration = Decoration.replace({});

type QuoteDecorations = { lines: DecorationSet; markers: DecorationSet };

export function quoteBlockDecorations(state: EditorState): QuoteDecorations {
  const lines = [];
  const markers = [];
  for (const quote of findQuoteLines(state.doc.toString())) {
    const line = state.doc.line(quote.line);
    lines.push(lineDecoration.range(line.from));
    markers.push(
      markerDecoration.range(line.from, line.from + quote.markerLength),
    );
  }
  return {
    lines: Decoration.set(lines),
    markers: Decoration.set(markers),
  };
}

const quoteBlockPlugin = ViewPlugin.fromClass(
  class {
    decorations: QuoteDecorations;

    constructor(view: EditorView) {
      this.decorations = quoteBlockDecorations(view.state);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.decorations = quoteBlockDecorations(update.state);
      }
    }
  },
  {
    provide: (plugin) => [
      EditorView.decorations.of(
        (view) => view.plugin(plugin)?.decorations.lines ?? Decoration.none,
      ),
      EditorView.decorations.of(
        (view) => view.plugin(plugin)?.decorations.markers ?? Decoration.none,
      ),
      // The caret skips hidden markers; Backspace at a quote's start removes
      // its marker, unquoting the line.
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations.markers ?? Decoration.none,
      ),
    ],
  },
);

/** Style Markdown blockquotes in the composer and hide their `>` markers. */
export const quoteBlockHighlighter: Extension = quoteBlockPlugin;
