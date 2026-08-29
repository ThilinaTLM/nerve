import {
  autocompletion,
  completionStatus,
  currentCompletions,
  selectedCompletionIndex,
  setSelectedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSection,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  FILE_COMPLETION_RESULT_LIMIT,
  type CompletionItem,
} from "@nervekit/contracts/completions";

export type ComposerCompletion = Completion & {
  matchRanges?: readonly number[];
  nerveKind?: CompletionItem["kind"];
};

export type ComposerCompletionOptions = {
  slashCompletions: () => readonly CompletionItem[];
  fileCompletions: () =>
    | ((query: string) => Promise<CompletionItem[]>)
    | undefined;
};

const commandSection: CompletionSection = { name: "Commands", rank: 0 };
const projectReferenceSection: CompletionSection = {
  name: "Project references",
  rank: 10,
};

export function composerCompletionBoost(
  sortScore: number | undefined,
): number | undefined {
  if (sortScore === undefined) return undefined;
  return Math.max(-99, Math.min(99, Math.round(sortScore / 160)));
}

export function toComposerCompletion(item: CompletionItem): ComposerCompletion {
  return {
    label: item.label,
    displayLabel: item.displayLabel,
    detail: item.detail,
    info: item.info,
    type:
      item.kind === "directory"
        ? "folder"
        : item.kind === "file"
          ? "file"
          : "keyword",
    apply: item.apply ?? item.label,
    boost: composerCompletionBoost(item.sortScore),
    section:
      item.kind === "directory" || item.kind === "file"
        ? projectReferenceSection
        : commandSection,
    matchRanges: item.matchRanges?.flatMap(([from, to]) => [from, to]),
    nerveKind: item.kind,
  };
}

function getCompletionMatch(completion: Completion): readonly number[] {
  return (completion as ComposerCompletion).matchRanges ?? [];
}

function completionOptionClass(completion: Completion): string {
  const kind = (completion as ComposerCompletion).nerveKind ?? "slash";
  return `nerve-completion-option nerve-completion-${kind}`;
}

// CodeMirror completion renderers run outside Svelte, so these icons are
// constructed with the DOM API from the same Lucide path data used by the UI.
const SVG_NS = "http://www.w3.org/2000/svg";
const lucideIcons = {
  file: [
    "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
    "M14 2v5a1 1 0 0 0 1 1h5",
  ],
  folder: [
    "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  ],
} as const;

function lucideIcon(name: keyof typeof lucideIcons, size = 14): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  for (const d of lucideIcons[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

function appendHighlighted(
  parent: Node,
  text: string,
  ranges: Array<[number, number]>,
): void {
  let cursor = 0;
  for (const [from, to] of ranges) {
    if (from > cursor) {
      parent.appendChild(document.createTextNode(text.slice(cursor, from)));
    }
    const mark = document.createElement("span");
    mark.className = "cm-nerve-match";
    mark.textContent = text.slice(from, to);
    parent.appendChild(mark);
    cursor = to;
  }
  if (cursor < text.length) {
    parent.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

function renderCompletionRow(completion: Completion): Node {
  const kind = (completion as ComposerCompletion).nerveKind;
  const labelRanges = (completion as ComposerCompletion).matchRanges ?? [];
  const row = document.createElement("span");
  row.className = "cm-nerve-row";

  const iconWrap = document.createElement("span");
  iconWrap.className = "cm-nerve-row-icon";
  iconWrap.appendChild(lucideIcon(kind === "directory" ? "folder" : "file"));
  row.appendChild(iconWrap);

  const main = document.createElement("span");
  main.className = "cm-nerve-row-main";
  if (kind === "file" || kind === "directory") {
    const rawLabel = completion.label ?? "";
    const rel =
      typeof completion.info === "string"
        ? completion.info
        : rawLabel.replace(/^@/, "");
    const isDir = kind === "directory";
    const baseRel = isDir ? rel.replace(/\/+$/, "") : rel;
    const nameStart = baseRel.lastIndexOf("/") + 1;
    const dir = baseRel.slice(0, nameStart);
    const name = baseRel.slice(nameStart) + (isDir ? "/" : "");
    const relRanges: Array<[number, number]> = [];
    for (let i = 0; i + 1 < labelRanges.length; i += 2) {
      const from = Math.max(0, labelRanges[i] - 1);
      const to = Math.min(baseRel.length, labelRanges[i + 1] - 1);
      if (to > from) relRanges.push([from, to]);
    }

    if (dir) {
      const dirElement = document.createElement("span");
      dirElement.className = "cm-nerve-row-dir";
      dirElement.textContent = "\u200e";
      appendHighlighted(
        dirElement,
        dir,
        relRanges
          .filter(([from]) => from < nameStart)
          .map(([from, to]) => [from, Math.min(to, nameStart)]),
      );
      main.appendChild(dirElement);
    }

    const nameElement = document.createElement("span");
    nameElement.className = "cm-nerve-row-name";
    appendHighlighted(
      nameElement,
      name,
      relRanges
        .filter(([, to]) => to > nameStart)
        .map(([from, to]) => [
          Math.max(from, nameStart) - nameStart,
          to - nameStart,
        ]),
    );
    main.appendChild(nameElement);
  } else {
    const nameElement = document.createElement("span");
    nameElement.className = "cm-nerve-row-name";
    nameElement.textContent = completion.label ?? "";
    main.appendChild(nameElement);
  }

  row.appendChild(main);
  return row;
}

export function createComposerCompletionSource(
  options: ComposerCompletionOptions,
): (context: CompletionContext) => Promise<CompletionResult | null> {
  return async (context) => {
    const before = context.matchBefore(/(?:^|\s)([/@][^\s]*)/);
    if (!before && !context.explicit) return null;
    const rawToken = before?.text.trimStart() ?? "";
    const tokenStart = before ? before.to - rawToken.length : context.pos;

    if (rawToken.startsWith("/")) {
      const completions = options
        .slashCompletions()
        .filter(
          (item) =>
            item.label.startsWith(rawToken) ||
            item.label.includes(rawToken.slice(1)),
        )
        .slice(0, FILE_COMPLETION_RESULT_LIMIT)
        .map(toComposerCompletion);
      return { from: tokenStart, options: completions, validFor: /^\/[\w-]*$/ };
    }

    if (rawToken.startsWith("@")) {
      context.addEventListener("abort", () => undefined, {
        onDocChange: true,
      });
      const query = rawToken.slice(1);
      const completions = ((await options.fileCompletions()?.(query)) ?? [])
        .slice(0, FILE_COMPLETION_RESULT_LIMIT)
        .reverse()
        .map(toComposerCompletion);
      if (context.aborted) return null;
      return {
        from: tokenStart,
        options: completions,
        filter: false,
        getMatch: getCompletionMatch,
      };
    }

    if (context.explicit) {
      return {
        from: context.pos,
        options: options
          .slashCompletions()
          .slice(0, FILE_COMPLETION_RESULT_LIMIT)
          .map(toComposerCompletion),
      };
    }

    return null;
  };
}

export const bestFileCompletionSelector: Extension = ViewPlugin.fromClass(
  class {
    private lastOptions: readonly Completion[] | undefined;

    update(update: ViewUpdate): void {
      if (completionStatus(update.state) !== "active") {
        this.lastOptions = undefined;
        return;
      }
      const completions = currentCompletions(update.state);
      const hasFileOptions = completions.some((completion) => {
        const kind = (completion as ComposerCompletion).nerveKind;
        return kind === "file" || kind === "directory";
      });
      if (!hasFileOptions || completions === this.lastOptions) return;
      this.lastOptions = completions;
      const editor = update.view;

      queueMicrotask(() => {
        if (completionStatus(editor.state) !== "active") return;
        if (currentCompletions(editor.state) !== completions) return;
        const bestIndex = completions.length - 1;
        if (
          bestIndex < 0 ||
          selectedCompletionIndex(editor.state) === bestIndex
        ) {
          return;
        }
        editor.dispatch({ effects: setSelectedCompletion(bestIndex) });
      });
    }
  },
);

export function composerCompletionExtensions(
  options: ComposerCompletionOptions,
) {
  if (options.slashCompletions().length === 0 && !options.fileCompletions()) {
    return [];
  }
  return autocompletion({
    override: [createComposerCompletionSource(options)],
    icons: false,
    aboveCursor: true,
    maxRenderedOptions: FILE_COMPLETION_RESULT_LIMIT,
    tooltipClass: () => "nerve-composer-completions",
    optionClass: completionOptionClass,
    addToOptions: [{ render: renderCompletionRow, position: 20 }],
  });
}
