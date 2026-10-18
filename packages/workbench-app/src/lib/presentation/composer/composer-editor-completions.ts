import {
  autocompletion,
  completionStatus,
  currentCompletions,
  selectedCompletionIndex,
  selectedCompletion,
  closeCompletion,
  startCompletion,
  setSelectedCompletion,
  type Completion,
  CompletionContext,
  type CompletionResult,
  type CompletionSection,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import {
  ViewPlugin,
  keymap,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import {
  FILE_COMPLETION_RESULT_LIMIT,
  type CompletionItem,
  type CompletionSearchResponse,
} from "@nervekit/contracts/completions";

import {
  ComposerReferenceSelection,
  type ReferenceSelectionScope,
} from "./composer-reference-selection.js";

export type ComposerReferenceSource = {
  search(query: string): Promise<CompletionSearchResponse>;
  select(
    item: CompletionItem,
    action: "select" | "disable",
  ): Promise<CompletionItem>;
  subscribe(listener: () => void): () => void;
};

export type ComposerCompletion = Completion & {
  referenceItem?: CompletionItem;
  referenceSource?: ComposerReferenceSource;
  matchRanges?: readonly number[];
  detailMatchRanges?: readonly number[];
  nerveKind?: CompletionItem["kind"];
};

export type ComposerCompletionOptions = {
  referenceSource?: () => ComposerReferenceSource | undefined;
  notice?: (message: string) => void;
  slashCompletions: () => readonly CompletionItem[];
  fileCompletions: () =>
    | ((query: string) => Promise<CompletionItem[]>)
    | undefined;
  referenceCompletions: () =>
    | ((
        kind: "launch" | "pull_request",
        query: string,
      ) => Promise<CompletionItem[]>)
    | undefined;
};

const COMPOSER_RENDERED_OPTION_LIMIT = 16;
const completionToken = /(?:^|\s)(?:\/[\w-]*|@[^\n@]*)$/;

const commandSection: CompletionSection = { name: "Commands", rank: 0 };
const projectReferenceSection: CompletionSection = {
  name: "Project references",
  rank: 30,
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
    section: item.kind === "slash" ? commandSection : projectReferenceSection,
    matchRanges: item.matchRanges?.flatMap(([from, to]) => [from, to]),
    detailMatchRanges: item.detailMatchRanges?.flatMap(([from, to]) => [
      from,
      to,
    ]),
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
  command: ["m4 17 6-6-6-6", "m12 19 8 0"],
  plan: [
    "M9 11l3 3L22 4",
    "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  ],
  code: ["m8 9-3 3 3 3", "m16 9 3 3-3 3", "m14 5-4 14"],
  compact: ["m8 3 4 4 4-4", "m8 21 4-4 4 4", "M12 7v10"],
  abort: ["M9 9h6v6H9z", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20"],
  new: [
    "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h6",
    "M19 3v6",
    "m22 6-6 0",
  ],
  launch: ["M4 17l6-6-6-6", "M12 19h8"],
  skill: [
    "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
  ],
  tool: [
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",
  ],
  agent: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    "M16 3.128a4 4 0 0 1 0 7.744",
    "M22 21v-2a4 4 0 0 0-3-3.87",
  ],
  issue: ["M12 8v4", "M12 16h.01", "M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0"],
  pullRequest: [
    "M18 15v-3a4 4 0 0 0-4-4h-4",
    "M14 5l-3 3 3 3",
    "M6 3v12",
    "M3 18a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
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

function completionIcon(completion: Completion): keyof typeof lucideIcons {
  const kind = (completion as ComposerCompletion).nerveKind;
  if (kind === "directory") return "folder";
  if (kind === "file") return "file";
  if (kind === "launch" || kind === "launch_definition") return "launch";
  if (kind === "skill") return "skill";
  if (kind === "tool") return "tool";
  if (kind === "subagent" || kind === "subagent_profile") return "agent";
  if (kind === "issue") return "issue";
  if (kind === "pull_request") return "pullRequest";
  const command = completion.label?.replace(/^\//, "");
  if (command && command in lucideIcons)
    return command as keyof typeof lucideIcons;
  return "command";
}

function renderCompletionRow(completion: Completion): Node {
  const kind = (completion as ComposerCompletion).nerveKind;
  const labelRanges = (completion as ComposerCompletion).matchRanges ?? [];
  const row = document.createElement("span");
  row.className = "cm-nerve-row";

  const iconWrap = document.createElement("span");
  iconWrap.className = "cm-nerve-row-icon";
  iconWrap.appendChild(lucideIcon(completionIcon(completion)));
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
      // The outer RTL box owns left ellipsis; this semantic inline isolates
      // the path's LTR order (including its trailing slash) from that box.
      const directoryText = document.createElement("bdi");
      directoryText.dir = "ltr";
      appendHighlighted(
        directoryText,
        dir,
        relRanges
          .filter(([from]) => from < nameStart)
          .map(([from, to]) => [from, Math.min(to, nameStart)]),
      );
      dirElement.appendChild(directoryText);
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
    const ranges: [number, number][] = [];
    for (let index = 0; index + 1 < labelRanges.length; index += 2)
      ranges.push([labelRanges[index]!, labelRanges[index + 1]!]);
    appendHighlighted(
      nameElement,
      completion.displayLabel ?? completion.label ?? "",
      ranges,
    );
    main.appendChild(nameElement);
    if (completion.detail) {
      const detailElement = document.createElement("span");
      detailElement.className = "cm-nerve-row-detail";
      const detailMatches =
        (completion as ComposerCompletion).detailMatchRanges ?? [];
      const ranges: [number, number][] = [];
      for (let index = 0; index + 1 < detailMatches.length; index += 2)
        ranges.push([detailMatches[index]!, detailMatches[index + 1]!]);
      appendHighlighted(detailElement, completion.detail, ranges);
      main.appendChild(detailElement);
    }
  }

  row.appendChild(main);
  return row;
}

type ReferenceGeneration = {
  value: number;
  action?: boolean;
  source?: ComposerReferenceSource;
};
const referenceGenerations = new WeakMap<
  ComposerCompletionOptions,
  ReferenceGeneration
>();
export function invalidateComposerCompletionRequests(
  options: ComposerCompletionOptions,
): void {
  const generation: ReferenceGeneration = referenceGenerations.get(options) ?? {
    value: 0,
  };
  generation.value++;
  generation.action = false;
  generation.source = undefined;
  referenceGenerations.set(options, generation);
}
export function composerReferenceActionPending(
  options: ComposerCompletionOptions,
): boolean {
  const generation = referenceGenerations.get(options);
  return (
    !!generation?.action && generation.source === options.referenceSource?.()
  );
}
function referenceOperation(
  options: ComposerCompletionOptions,
  source: ComposerReferenceSource,
  view?: EditorView,
): (() => boolean) & { finish(): void } {
  invalidateComposerCompletionRequests(options);
  const generation = referenceGenerations.get(options)!;
  const value = generation.value;
  generation.action = !!view;
  generation.source = source;
  const document = view?.state.doc;
  const live = () =>
    generation.value === value && options.referenceSource?.() === source;
  return Object.assign(() => live() && (!view || view.state.doc === document), {
    finish() {
      if (generation.value === value) generation.action = false;
    },
  });
}

const pendingReferenceActions = new WeakMap<
  EditorView,
  { source: ComposerReferenceSource; document: EditorView["state"]["doc"] }
>();

export function runComposerReferenceAction(
  view: EditorView,
  options: ComposerCompletionOptions,
  source: ComposerReferenceSource,
  item: CompletionItem,
  action: "select" | "disable",
  onSelected?: (selected: CompletionItem) => void,
): boolean {
  if (
    options.referenceSource?.() !== source ||
    (action === "disable" && !item.canDisable)
  )
    return false;
  const pending = pendingReferenceActions.get(view);
  if (pending?.source === source && pending.document === view.state.doc)
    return true;
  const current = referenceOperation(options, source, view);
  if (action === "select" && item.available === false) {
    options.notice?.(item.unavailableReason ?? "Completion is unavailable");
    current.finish();
    return true;
  }
  const operation = { source, document: view.state.doc };
  pendingReferenceActions.set(view, operation);
  options.notice?.(
    action === "disable"
      ? "Disabling completion"
      : item.enabled === false
        ? "Enabling completion"
        : "Selecting completion",
  );
  void (async () => source.select(item, action))()
    .then((selected) => {
      if (!current()) return;
      options.notice?.(
        action === "disable"
          ? `Disabled ${item.displayLabel ?? item.label}`
          : "",
      );
      if (!current()) return;
      // Close while this operation still owns the document. Applying the chosen
      // text legitimately invalidates this generation via the editor listener.
      closeCompletion(view);
      if (current()) onSelected?.(selected);
    })
    .catch((error: unknown) => {
      if (current())
        options.notice?.(
          error instanceof Error
            ? error.message
            : action === "disable"
              ? "Could not disable completion"
              : "Completion selection failed",
        );
    })
    .finally(() => {
      if (pendingReferenceActions.get(view) === operation)
        pendingReferenceActions.delete(view);
      current.finish();
    });
  return true;
}

function referenceCompletion(
  item: CompletionItem,
  source: ComposerReferenceSource,
  options: ComposerCompletionOptions,
): ComposerCompletion {
  const completion = toComposerCompletion(item);
  const state =
    item.available === false
      ? `${item.unavailableReason ?? "Unavailable"}${item.canDisable && item.enabled !== false ? " · Alt+Shift+D to disable" : ""}`
      : item.enabled === false
        ? "Disabled · selecting enables"
        : item.canDisable
          ? "Enabled · Alt+Shift+D to disable"
          : "";
  return {
    ...completion,
    detail: [item.detail, state].filter(Boolean).join(" · "),
    referenceItem: item,
    referenceSource: source,
    apply(view, _completion, from, to) {
      runComposerReferenceAction(
        view,
        options,
        source,
        item,
        "select",
        (selected) => {
          const insert = selected.apply ?? selected.label;
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
          });
        },
      );
    },
  };
}

export function disableSelectedComposerCompletion(
  view: EditorView,
  options: ComposerCompletionOptions,
): boolean {
  const completion = selectedCompletion(
    view.state,
  ) as ComposerCompletion | null;
  const item = completion?.referenceItem;
  const source = completion?.referenceSource;
  return (
    !!item &&
    !!source &&
    runComposerReferenceAction(view, options, source, item, "disable")
  );
}

export function createComposerCompletionSource(
  options: ComposerCompletionOptions,
): (context: CompletionContext) => Promise<CompletionResult | null> {
  return async (context) => {
    const before = context.matchBefore(completionToken);
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

      const referenceSource = options.referenceSource?.();
      if (referenceSource) {
        const current = referenceOperation(options, referenceSource);
        try {
          const response = await referenceSource.search(rawToken.slice(1));
          if (context.aborted || !current()) return null;
          options.notice?.(
            response.sources.some(
              (source) => source.status === "loading" || source.refreshing,
            )
              ? "Refreshing completions"
              : response.sources.some(
                    (source) => source.status === "unavailable",
                  )
                ? "Some completion sources are unavailable"
                : response.sources.some((source) => source.status === "stale")
                  ? "Some completion results are stale"
                  : "",
          );
          return {
            from: tokenStart,
            options: response.items
              .slice(0, FILE_COMPLETION_RESULT_LIMIT)
              .map((item) =>
                referenceCompletion(item, referenceSource, options),
              ),
            filter: false,
            getMatch: getCompletionMatch,
          };
        } catch (error) {
          if (!context.aborted && current())
            options.notice?.(
              error instanceof Error
                ? error.message
                : "Completion search failed",
            );
          return null;
        }
      }

      if (rawToken.startsWith("@launch:")) {
        const items =
          (await options.referenceCompletions()?.(
            "launch",
            rawToken.slice("@launch:".length),
          )) ?? [];
        if (context.aborted) return null;
        return {
          from: tokenStart,
          options: items
            .slice(0, FILE_COMPLETION_RESULT_LIMIT)
            .map(toComposerCompletion),
          filter: false,
        };
      }

      if (rawToken.startsWith("@pr:")) {
        const items =
          (await options.referenceCompletions()?.(
            "pull_request",
            rawToken.slice("@pr:".length),
          )) ?? [];
        if (context.aborted) return null;
        return {
          from: tokenStart,
          options: items
            .slice(0, FILE_COMPLETION_RESULT_LIMIT)
            .map(toComposerCompletion),
          filter: false,
        };
      }

      const query = rawToken.startsWith("@file:")
        ? rawToken.slice("@file:".length)
        : rawToken.slice(1);
      const files = ((await options.fileCompletions()?.(query)) ?? []).slice(
        0,
        FILE_COMPLETION_RESULT_LIMIT,
      );
      if (context.aborted) return null;
      const starters: CompletionItem[] =
        rawToken === "@" && options.referenceCompletions()
          ? [
              {
                label: "@launch:",
                detail: "Mention a background launch",
                kind: "launch",
              },
              {
                label: "@pr:",
                detail: "Mention a pull request",
                kind: "pull_request",
              },
            ]
          : [];
      return {
        from: tokenStart,
        options: [...files, ...starters].map(toComposerCompletion),
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

const referenceSelections = new WeakMap<
  EditorView,
  ComposerReferenceSelection
>();
const refreshingReferenceViews = new WeakSet<EditorView>();
const referenceCandidate = (completion?: Completion | null) => {
  const item = (completion as ComposerCompletion | undefined)?.referenceItem;
  return { id: item?.documentId, eligible: item?.available !== false };
};
function referenceSelectionScope(
  view: EditorView,
  source: ComposerReferenceSource,
): ReferenceSelectionScope {
  const at = view.state.selection.main.head;
  const token = new CompletionContext(view.state, at, false).matchBefore(
    completionToken,
  );
  return {
    document: view.state.doc,
    source,
    query: token?.text.trimStart() ?? "",
    at,
  };
}

/** Preserve only the user's explicit eligible entity across this same-query
 * refresh; arbitrary closes/new query/source changes still default to best0. */
export function refreshComposerReferenceCompletions(
  view: EditorView,
  options: ComposerCompletionOptions,
): void {
  const source = options.referenceSource?.();
  if (composerReferenceActionPending(options)) return;
  const selection = referenceSelections.get(view);
  const selected = selectedCompletion(view.state) as ComposerCompletion | null;
  if (source && (!selected || selected.referenceSource === source))
    selection?.prepareRefresh(
      referenceSelectionScope(view, source),
      selected ? referenceCandidate(selected) : undefined,
    );
  else selection?.clear();
  refreshingReferenceViews.add(view);
  try {
    invalidateComposerCompletionRequests(options);
    closeCompletion(view);
    startCompletion(view);
  } finally {
    refreshingReferenceViews.delete(view);
  }
}

export const bestReferenceCompletionSelector: Extension = ViewPlugin.fromClass(
  class {
    private readonly selection = new ComposerReferenceSelection();
    private lastOptions: readonly Completion[] | undefined;
    private lastSelected: Completion | null = null;
    private applying = false;
    constructor(private readonly view: EditorView) {
      referenceSelections.set(view, this.selection);
    }
    destroy(): void {
      referenceSelections.delete(this.view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.selection.clear();
      const status = completionStatus(update.state);
      if (status !== "active") {
        this.lastOptions = undefined;
        this.lastSelected = null;
        if (status === null && !refreshingReferenceViews.has(update.view))
          this.selection.clear();
        return;
      }
      const completions = currentCompletions(update.state);
      if (
        !completions.some((completion) => {
          const kind = (completion as ComposerCompletion).nerveKind;
          return !!kind && kind !== "slash";
        })
      )
        return;
      const selected = selectedCompletion(update.state);
      const source = (completions[0] as ComposerCompletion | undefined)
        ?.referenceSource;
      const scope = source
        ? referenceSelectionScope(update.view, source)
        : undefined;
      if (completions === this.lastOptions) {
        if (!this.applying && selected !== this.lastSelected && scope)
          this.selection.remember(scope, referenceCandidate(selected));
        this.lastSelected = selected;
        return;
      }
      this.lastOptions = completions;
      this.lastSelected = selected;
      const desired = this.selection.resolve(
        scope,
        completions.map(referenceCandidate),
      );
      const editor = update.view;
      const before = selectedCompletionIndex(update.state);
      queueMicrotask(() => {
        if (
          completionStatus(editor.state) !== "active" ||
          currentCompletions(editor.state) !== completions ||
          selectedCompletionIndex(editor.state) !== before ||
          before === desired
        )
          return;
        this.applying = true;
        try {
          editor.dispatch({ effects: setSelectedCompletion(desired) });
        } finally {
          this.applying = false;
        }
      });
    }
  },
);

export function composerCompletionExtensions(
  options: ComposerCompletionOptions,
) {
  if (
    options.slashCompletions().length === 0 &&
    !options.fileCompletions() &&
    !options.referenceCompletions() &&
    !options.referenceSource?.()
  ) {
    return [];
  }
  return [
    keymap.of([
      {
        key: "Alt-Shift-d",
        run: (view) => disableSelectedComposerCompletion(view, options),
      },
    ]),
    autocompletion({
      override: [createComposerCompletionSource(options)],
      icons: false,
      aboveCursor: true,
      maxRenderedOptions: COMPOSER_RENDERED_OPTION_LIMIT,
      tooltipClass: () => "nerve-composer-completions",
      optionClass: completionOptionClass,
      addToOptions: [{ render: renderCompletionRow, position: 20 }],
    }),
  ];
}
