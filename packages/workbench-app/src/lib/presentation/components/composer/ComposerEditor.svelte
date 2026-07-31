<script lang="ts">
import { onDestroy, onMount } from "svelte";
import FileIcon from "@lucide/svelte/icons/file";
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionStatus,
  currentCompletions,
  selectedCompletionIndex,
  setSelectedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionSection,
} from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder as placeholderExtension,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  FILE_COMPLETION_RESULT_LIMIT,
  findExecutableCommandBlocks,
  type CompletionItem,
} from "@nervekit/contracts";

type Props = {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  focusToken?: number;
  slashCompletions?: CompletionItem[];
  fileCompletions?: (query: string) => Promise<CompletionItem[]>;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  onPasteImage?: (file: File) => Promise<string>;
  onDropFiles?: (files: readonly File[]) => Promise<readonly string[]>;
};

type ComposerCompletion = Completion & {
  matchRanges?: readonly number[];
  nerveKind?: CompletionItem["kind"];
};

const commandSection: CompletionSection = { name: "Commands", rank: 0 };
const projectReferenceSection: CompletionSection = {
  name: "Project references",
  rank: 10,
};

let {
  value,
  placeholder = "Ask the Nerve agent",
  disabled = false,
  focusToken = 0,
  slashCompletions = [],
  fileCompletions,
  onChange,
  onSubmit,
  onPasteImage,
  onDropFiles,
}: Props = $props();

let host: HTMLDivElement;
let view: EditorView | undefined;
let editorValue = $state("");
let lastFocusToken = 0;
let fileDragDepth = 0;
let fileDragActive = $state(false);
const editableCompartment = new Compartment();
const completionCompartment = new Compartment();
const placeholderCompartment = new Compartment();

const completionsEnabled = $derived(
  slashCompletions.length > 0 || Boolean(fileCompletions),
);

function editableExtensions(isDisabled: boolean) {
  return [
    EditorState.readOnly.of(isDisabled),
    EditorView.editable.of(!isDisabled),
  ];
}

function sectionFor(item: CompletionItem): CompletionSection {
  if (item.kind === "directory" || item.kind === "file") {
    return projectReferenceSection;
  }
  return commandSection;
}

function boostFor(item: CompletionItem): number | undefined {
  if (item.sortScore === undefined) return undefined;
  return Math.max(-99, Math.min(99, Math.round(item.sortScore / 160)));
}

function toCompletion(item: CompletionItem): ComposerCompletion {
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
    boost: boostFor(item),
    section: sectionFor(item),
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

// Lucide (v1.17) icon path data, mirrored from @lucide/svelte. CodeMirror's
// completion `render` runs in a vanilla-DOM context, so we build inline SVG
// with createElementNS instead of mounting @lucide/svelte components.
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
    if (from > cursor)
      parent.appendChild(document.createTextNode(text.slice(cursor, from)));
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
  iconWrap.appendChild(
    kind === "directory"
      ? lucideIcon("folder")
      : kind === "file"
        ? lucideIcon("file")
        : lucideIcon("file"),
  );
  row.appendChild(iconWrap);

  const main = document.createElement("span");
  main.className = "cm-nerve-row-main";

  if (kind === "file" || kind === "directory") {
    // Label coordinates: index 0 is the leading "@"; index 1 onward is the
    // project-relative path (+ trailing "/" for directories).
    const rawLabel = completion.label ?? "";
    const info = completion.info;
    const rel = typeof info === "string" ? info : rawLabel.replace(/^@/, "");
    const isDir = kind === "directory";
    const baseRel = isDir ? rel.replace(/\/+$/, "") : rel;
    const nameStart = baseRel.lastIndexOf("/") + 1;
    const dir = baseRel.slice(0, nameStart);
    const name = baseRel.slice(nameStart) + (isDir ? "/" : "");

    // matchRanges is stored as a flat [from, to, from, to, ...] sequence
    // (flattened for CodeMirror's getMatch). Re-pair it, then shift from
    // label-space into rel-space by subtracting 1 for the leading "@".
    const relRanges: Array<[number, number]> = [];
    for (let i = 0; i + 1 < labelRanges.length; i += 2) {
      const a = Math.max(0, labelRanges[i] - 1);
      const b = Math.min(baseRel.length, labelRanges[i + 1] - 1);
      if (b > a) relRanges.push([a, b]);
    }

    if (dir) {
      const dirEl = document.createElement("span");
      dirEl.className = "cm-nerve-row-dir";
      // LRM keeps the leading character anchored when direction:rtl ellipsizes
      // the directory prefix on the left, so the closest folder stays visible.
      dirEl.textContent = "\u200e";
      appendHighlighted(
        dirEl,
        dir,
        relRanges
          .filter(([from]) => from < nameStart)
          .map(
            ([from, to]) => [from, Math.min(to, nameStart)] as [number, number],
          ),
      );
      main.appendChild(dirEl);
    }

    const nameEl = document.createElement("span");
    nameEl.className = "cm-nerve-row-name";
    // Split ranges that cross the dir/name boundary at nameStart so the leaf
    // portion of a spanning match is highlighted too.
    appendHighlighted(
      nameEl,
      name,
      relRanges
        .filter(([, to]) => to > nameStart)
        .map(
          ([from, to]) =>
            [Math.max(from, nameStart) - nameStart, to - nameStart] as [
              number,
              number,
            ],
        ),
    );
    main.appendChild(nameEl);
  } else {
    const nameEl = document.createElement("span");
    nameEl.className = "cm-nerve-row-name";
    nameEl.textContent = completion.label ?? "";
    main.appendChild(nameEl);
  }

  row.appendChild(main);
  return row;
}

async function completionSource(context: CompletionContext) {
  const before = context.matchBefore(/(?:^|\s)([/@][^\s]*)/);
  if (!before && !context.explicit) return null;
  const rawToken = before?.text.trimStart() ?? "";
  const tokenStart = before ? before.to - rawToken.length : context.pos;

  if (rawToken.startsWith("/")) {
    const options = slashCompletions
      .filter(
        (item) =>
          item.label.startsWith(rawToken) ||
          item.label.includes(rawToken.slice(1)),
      )
      .slice(0, FILE_COMPLETION_RESULT_LIMIT)
      .map(toCompletion);
    return { from: tokenStart, options, validFor: /^\/[\w-]*$/ };
  }

  if (rawToken.startsWith("@")) {
    context.addEventListener("abort", () => undefined, { onDocChange: true });
    const query = rawToken.slice(1);
    const options = ((await fileCompletions?.(query)) ?? [])
      .slice(0, FILE_COMPLETION_RESULT_LIMIT)
      .reverse()
      .map(toCompletion);
    if (context.aborted) return null;
    return {
      from: tokenStart,
      options,
      filter: false,
      getMatch: getCompletionMatch,
    };
  }

  if (context.explicit) {
    return {
      from: context.pos,
      options: slashCompletions
        .slice(0, FILE_COMPLETION_RESULT_LIMIT)
        .map(toCompletion),
    };
  }

  return null;
}

function executableCommandBlockDecorations(state: EditorState): DecorationSet {
  const ranges = [];
  const blockLine = Decoration.line({
    class: "cm-executable-command-block-line",
  });
  const commandMark = Decoration.mark({
    class: "cm-executable-command-block-command",
  });
  for (const block of findExecutableCommandBlocks(state.doc.toString())) {
    let pos = block.start;
    while (pos < block.end) {
      const line = state.doc.lineAt(pos);
      ranges.push(blockLine.range(line.from));
      if (line.to >= block.end) break;
      pos = line.to + 1;
    }
    if (block.commandEnd > block.commandStart) {
      ranges.push(commandMark.range(block.commandStart, block.commandEnd));
    }
  }
  return Decoration.set(
    ranges.sort((a, b) => a.from - b.from || a.to - b.to),
    true,
  );
}

const bestFileCompletionSelector = ViewPlugin.fromClass(
  class {
    private lastOptions: readonly Completion[] | undefined;

    update(update: ViewUpdate): void {
      if (completionStatus(update.state) !== "active") {
        this.lastOptions = undefined;
        return;
      }
      const options = currentCompletions(update.state);
      const hasFileOptions = options.some((completion) => {
        const kind = (completion as ComposerCompletion).nerveKind;
        return kind === "file" || kind === "directory";
      });
      if (!hasFileOptions || options === this.lastOptions) return;
      this.lastOptions = options;

      queueMicrotask(() => {
        if (!view || completionStatus(view.state) !== "active") return;
        if (currentCompletions(view.state) !== options) return;
        const bestIndex = options.length - 1;
        if (
          bestIndex < 0 ||
          selectedCompletionIndex(view.state) === bestIndex
        ) {
          return;
        }
        view.dispatch({ effects: setSelectedCompletion(bestIndex) });
      });
    }
  },
);

const executableCommandBlockHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = executableCommandBlockDecorations(view.state);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = executableCommandBlockDecorations(update.state);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

function completionExtensions() {
  if (!completionsEnabled) return [];
  return autocompletion({
    override: [completionSource],
    icons: false,
    aboveCursor: true,
    maxRenderedOptions: FILE_COMPLETION_RESULT_LIMIT,
    tooltipClass: () => "nerve-composer-completions",
    optionClass: completionOptionClass,
    addToOptions: [{ render: renderCompletionRow, position: 20 }],
  });
}

function submit() {
  if (disabled) return false;
  onSubmit?.();
  return true;
}

function submitOnEnter(target: EditorView) {
  // Let the autocomplete keymap handle Enter when a completion popup is open.
  if (completionStatus(target.state) === "active") return false;
  return submit();
}

function acceptCompletionOnTab(target: EditorView): boolean {
  if (completionStatus(target.state) !== "active") return false;
  return acceptCompletion(target);
}

function insertAtRange(text: string, from?: number, to?: number) {
  if (!view || !text) return;
  const selection = view.state.selection.main;
  const docLength = view.state.doc.length;
  const insertFrom = Math.min(from ?? selection.from, docLength);
  const insertTo = Math.min(to ?? selection.to, docLength);
  view.dispatch({
    changes: { from: insertFrom, to: insertTo, insert: text },
    selection: { anchor: insertFrom + text.length },
    scrollIntoView: true,
  });
  view.focus();
}

function insertDroppedPaths(
  paths: readonly string[],
  selection: { from: number; to: number },
): void {
  if (!view || paths.length === 0) return;
  const doc = view.state.doc;
  const from = Math.min(selection.from, doc.length);
  const to = Math.min(selection.to, doc.length);
  const before = from > 0 ? doc.sliceString(from - 1, from) : "";
  const after = to < doc.length ? doc.sliceString(to, to + 1) : "";
  const leadingSpace = before && !/\s/.test(before) ? " " : "";
  const trailingSpace = after && !/\s/.test(after) ? " " : "";
  insertAtRange(`${leadingSpace}${paths.join(" ")}${trailingSpace}`, from, to);
}

function hasFileItems(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return (
    Array.from(dataTransfer.items).some((item) => item.kind === "file") ||
    Array.from(dataTransfer.types).includes("Files")
  );
}

function canHandleFileDrag(event: DragEvent): boolean {
  return Boolean(!disabled && onDropFiles && hasFileItems(event.dataTransfer));
}

function handleFileDragEnter(event: DragEvent): void {
  if (!canHandleFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  fileDragDepth += 1;
  fileDragActive = true;
}

function handleFileDragOver(event: DragEvent): void {
  if (!canHandleFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function handleFileDragLeave(event: DragEvent): void {
  if (!fileDragActive) return;
  event.preventDefault();
  event.stopPropagation();
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (fileDragDepth === 0) fileDragActive = false;
}

function handleFileDrop(event: DragEvent): void {
  if (!canHandleFileDrag(event) || !onDropFiles || !view) return;
  event.preventDefault();
  event.stopPropagation();
  fileDragDepth = 0;
  fileDragActive = false;

  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;
  const { from, to } = view.state.selection.main;
  void onDropFiles(files)
    .then((paths) => insertDroppedPaths(paths, { from, to }))
    .catch((error: unknown) => {
      console.error("Failed to resolve dropped file paths", error);
    });
}

function handlePaste(event: ClipboardEvent) {
  if (disabled || !onPasteImage) return false;
  const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
  if (!files.length) return false;
  event.preventDefault();
  void Promise.all(files.map((file) => onPasteImage(file)))
    .then((paths) => insertAtRange(paths.join("\n")))
    .catch((error: unknown) => {
      console.error("Failed to paste clipboard image", error);
    });
  return true;
}

onMount(() => {
  editorValue = value;
  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: value,
      extensions: [
        history(),
        markdown(),
        placeholderCompartment.of(placeholderExtension(placeholder)),
        editableCompartment.of(editableExtensions(disabled)),
        completionCompartment.of(completionExtensions()),
        executableCommandBlockHighlighter,
        bestFileCompletionSelector,
        Prec.highest(
          keymap.of([
            { key: "Enter", run: submitOnEnter },
            { key: "Tab", run: acceptCompletionOnTab },
            { key: "Escape", run: closeCompletion },
            { key: "Mod-Enter", run: submit },
            { key: "Ctrl-Enter", run: submit },
            indentWithTab,
          ]),
        ),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.domEventHandlers({ paste: handlePaste }),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (!update.docChanged) return;
          editorValue = update.state.doc.toString();
          onChange?.(editorValue);
        }),
        EditorView.theme({
          "&": {
            background: "transparent",
            color: "var(--foreground)",
            maxHeight: "min(40vh, 320px)",
          },
          ".cm-content": {
            caretColor: "var(--primary)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            lineHeight: "1.5",
            padding: "18px 46px 14px 11px",
          },
          ".cm-line": {
            padding: "0 2px",
          },
          ".cm-cursor": {
            borderLeftColor: "var(--primary)",
          },
          ".cm-placeholder": {
            color:
              "color-mix(in oklab, var(--muted-foreground) 75%, transparent)",
          },
          ".cm-executable-command-block-line": {
            backgroundColor: "color-mix(in oklab, var(--info) 9%, transparent)",
          },
          ".cm-executable-command-block-command": {
            backgroundColor:
              "color-mix(in oklab, var(--info) 16%, transparent)",
            color: "var(--foreground)",
            borderRadius: "var(--radius-sm)",
          },
          ".cm-scroller": {
            minHeight: "92px",
            maxHeight: "min(40vh, 320px)",
            overflow: "auto",
          },
          ".cm-tooltip": {
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--popover)",
            color: "var(--popover-foreground)",
            boxShadow: "var(--shadow-lg)",
            overflow: "hidden",
          },
          ".cm-tooltip-autocomplete.nerve-composer-completions": {
            minWidth: "min(24rem, calc(100vw - 2rem))",
            maxWidth: "min(34rem, calc(100vw - 2rem))",
            padding: "0.15rem",
          },
          ".cm-tooltip-autocomplete.nerve-composer-completions > ul": {
            maxHeight: "none",
            overflow: "hidden",
            padding: "0.1rem",
            fontFamily: "var(--font-mono)",
          },
          ".cm-tooltip-autocomplete.nerve-composer-completions > ul > completion-section":
            {
              borderBottom: "0",
              color: "var(--muted-foreground)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-xs)",
              fontWeight: "500",
              letterSpacing: "0.02em",
              padding: "0.25rem 0.4rem 0.15rem",
              textTransform: "uppercase",
            },
          ".cm-tooltip-autocomplete.nerve-composer-completions > ul > li": {
            display: "flex",
            alignItems: "center",
            minHeight: "1.55rem",
            borderRadius: "var(--radius-sm)",
            padding: "0.18rem 0.4rem",
            color: "var(--popover-foreground)",
          },
          ".cm-tooltip-autocomplete.nerve-composer-completions > ul > li[aria-selected]":
            {
              background: "var(--accent)",
              color: "var(--accent-foreground)",
            },
          // We render our own row (icon + left-truncated dir + filename); hide
          // CodeMirror's default label/detail to avoid duplicate/clipped text.
          ".cm-tooltip-autocomplete.nerve-composer-completions .cm-completionLabel":
            {
              display: "none",
            },
          ".cm-tooltip-autocomplete.nerve-composer-completions .cm-completionDetail":
            {
              display: "none",
            },
          ".cm-tooltip-autocomplete.nerve-composer-completions .cm-nerve-row": {
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            minWidth: "0",
            width: "100%",
          },
          ".cm-tooltip-autocomplete.nerve-composer-completions .cm-nerve-row-icon":
            {
              display: "inline-flex",
              flexShrink: "0",
              alignItems: "center",
              color: "var(--muted-foreground)",
            },
          ".cm-tooltip-autocomplete.nerve-composer-completions .nerve-completion-directory .cm-nerve-row-icon":
            {
              color: "var(--info)",
            },
          ".cm-tooltip-autocomplete.nerve-composer-completions .nerve-completion-file .cm-nerve-row-icon":
            {
              color: "var(--success)",
            },
          ".cm-tooltip-autocomplete.nerve-composer-completions .cm-nerve-row-main":
            {
              display: "flex",
              alignItems: "baseline",
              gap: "0.3rem",
              flex: "1",
              minWidth: "0",
            },
          ".cm-tooltip-autocomplete.nerve-composer-completions .cm-nerve-row-dir":
            {
              flexShrink: "1",
              minWidth: "0",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              direction: "rtl",
              textAlign: "left",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-xs)",
              color: "var(--muted-foreground)",
            },
          ".cm-tooltip-autocomplete.nerve-composer-completions .cm-nerve-row-name":
            {
              flexShrink: "0",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-sm)",
              fontWeight: "500",
              color: "var(--popover-foreground)",
            },
          ".cm-tooltip-autocomplete.nerve-composer-completions .cm-nerve-match":
            {
              color: "var(--primary)",
              fontWeight: "600",
            },
          ".cm-tooltip.cm-completionInfo": {
            maxWidth: "min(30rem, calc(100vw - 2rem))",
            padding: "0.55rem 0.7rem",
            color: "var(--popover-foreground)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
          },
          "&.cm-focused": {
            outline: "none",
          },
          "&.cm-focused .cm-cursor": {
            borderLeftColor: "var(--primary)",
          },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
            {
              backgroundColor:
                "color-mix(in oklab, var(--primary) 22%, transparent)",
            },
        }),
      ],
    }),
  });
});

$effect(() => {
  if (!view) return;
  view.dispatch({
    effects: editableCompartment.reconfigure(editableExtensions(disabled)),
  });
  if (disabled) {
    fileDragDepth = 0;
    fileDragActive = false;
  }
});

$effect(() => {
  if (!view) return;
  void slashCompletions;
  void fileCompletions;
  view.dispatch({
    effects: completionCompartment.reconfigure(completionExtensions()),
  });
});

$effect(() => {
  if (!view) return;
  view.dispatch({
    effects: placeholderCompartment.reconfigure(
      placeholderExtension(placeholder),
    ),
  });
});

$effect(() => {
  if (!view || disabled || focusToken === lastFocusToken) return;
  lastFocusToken = focusToken;
  view.focus();
});

$effect(() => {
  if (!view || value === editorValue) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
  });
  editorValue = value;
});

onDestroy(() => view?.destroy());
</script>

<div
  class="composer-editor relative"
  class:disabled
  role="group"
  aria-label="Prompt editor drop area"
  ondragentercapture={handleFileDragEnter}
  ondragovercapture={handleFileDragOver}
  ondragleavecapture={handleFileDragLeave}
  ondropcapture={handleFileDrop}
>
  <div bind:this={host}></div>
  {#if fileDragActive}
    <div
      class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-md border border-primary bg-background/95 px-4 text-sm font-medium text-foreground shadow-sm"
      aria-hidden="true"
    >
      <FileIcon class="size-4 text-primary" />
      <span>Drop files or folders to add their paths</span>
    </div>
  {/if}
</div>

<style>
.composer-editor {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--input);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    opacity 160ms ease;
}

.composer-editor:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--ring) 35%, transparent);
}

.composer-editor.disabled {
  opacity: 0.58;
}

/* Phone: composer text must be >= 16px so iOS does not zoom on focus.
     Targets the CodeMirror-rendered content (escape hatch: rendered HTML). */
@media (max-width: 639px) {
  .composer-editor :global(.cm-editor .cm-content) {
    font-size: 1rem;
  }
}
</style>
