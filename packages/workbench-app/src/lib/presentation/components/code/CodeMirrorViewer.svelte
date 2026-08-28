<script lang="ts">
import { foldAll, foldCode, unfoldAll, unfoldCode } from "@codemirror/language";
import {
  findNext,
  findPrevious,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Check from "@lucide/svelte/icons/check";
import Copy from "@lucide/svelte/icons/copy";
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import ScanText from "@lucide/svelte/icons/scan-text";
import Search from "@lucide/svelte/icons/search";
import TextSelect from "@lucide/svelte/icons/text-select";
import UnfoldVertical from "@lucide/svelte/icons/unfold-vertical";
import WrapText from "@lucide/svelte/icons/wrap-text";
import { writeClipboardText } from "@nervekit/ui-kit/core/clipboard";
import ContextMenuList, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import { mount, onDestroy, onMount } from "svelte";
import CodeMirrorFindPanel from "./CodeMirrorFindPanel.svelte";
import {
  canFoldAt,
  canUnfoldAt,
  contextSelection,
  isSearchQueryValid,
  searchMatchStatus,
  selectedSearchText,
  viewerShortcut,
} from "./code-viewer-helpers";
import {
  loadCodeLanguage,
  localLineNumber,
  readOnlyCodeExtensions,
} from "./code-mirror-config";

type Props = {
  text: string;
  language?: string;
  lineStart?: number;
  targetLine?: number;
  wrap?: boolean;
  ariaLabel?: string;
  class?: string;
  onCopy?: (ok: boolean) => void;
  highlightSelectionMatches?: boolean;
  onToggleSelectionMatches?: () => void;
  onToggleWrap?: () => void;
};

let {
  text,
  language,
  lineStart = 1,
  targetLine,
  wrap = false,
  ariaLabel = "Code viewer",
  class: className = "",
  onCopy,
  highlightSelectionMatches = false,
  onToggleSelectionMatches,
  onToggleWrap,
}: Props = $props();

let host: HTMLElement;
let view: EditorView | undefined;
let languageGeneration = 0;
let contextPosition = $state(0);
let contextVersion = $state(0);
let findOpen = $state(false);
let findText = $state("");
let findCaseSensitive = $state(false);
let findWholeWord = $state(false);
let findRegexp = $state(false);
let findStatus = $state("0 results");
let findValid = $state(true);

const baseCompartment = new Compartment();
const languageCompartment = new Compartment();
const wrapCompartment = new Compartment();
const targetCompartment = new Compartment();

function codeFoldMarker(open: boolean): HTMLElement {
  const dom = document.createElement("span");
  dom.className = "cm-fold-marker";
  dom.setAttribute("aria-hidden", "true");
  mount(open ? ChevronDown : ChevronRight, {
    target: dom,
    props: { class: "size-3.5" },
  });
  return dom;
}

function targetLineExtension(
  state: EditorState,
  externalLine: number | undefined,
  firstLine: number,
): Extension {
  const local = localLineNumber(externalLine, firstLine, state.doc.lines);
  if (!local) return [];
  return EditorView.decorations.of(
    Decoration.set([
      Decoration.line({ class: "cm-target-line" }).range(
        state.doc.line(local).from,
      ),
    ]),
  );
}

function currentQuery(): SearchQuery {
  return new SearchQuery({
    search: findText,
    caseSensitive: findCaseSensitive,
    wholeWord: findWholeWord,
    regexp: findRegexp,
  });
}

function updateFindStatus(): void {
  if (!view) return;
  const query = currentQuery();
  findValid = isSearchQueryValid(query);
  const status = searchMatchStatus(view.state, query);
  if (!query.search) findStatus = "0 results";
  else if (status.current)
    findStatus = `${status.current} of ${status.capped ? `${status.count}+` : status.count}`;
  else
    findStatus = status.capped
      ? `${status.count}+ results`
      : `${status.count} results`;
}

function applyFindQuery(): void {
  if (!view) return;
  view.dispatch({ effects: setSearchQuery.of(currentQuery()) });
  updateFindStatus();
}

function setFindText(value: string): void {
  findText = value;
  applyFindQuery();
}

function setFindOption(
  option: "case" | "word" | "regexp",
  value: boolean,
): void {
  if (option === "case") findCaseSensitive = value;
  else if (option === "word") findWholeWord = value;
  else findRegexp = value;
  applyFindQuery();
}

function openFind(seedFromSelection = true): void {
  if (!view) return;
  const selected = seedFromSelection
    ? selectedSearchText(view.state)
    : undefined;
  if (selected) findText = selected;
  findOpen = true;
  applyFindQuery();
}

function closeFind(): void {
  findOpen = false;
  view?.dispatch({
    effects: setSearchQuery.of(new SearchQuery({ search: "" })),
  });
  requestAnimationFrame(() => view?.focus());
}

function moveMatch(previous: boolean): void {
  if (!view || !currentQuery().valid || !findText) return;
  (previous ? findPrevious : findNext)(view);
  updateFindStatus();
}

function selectAllText(): void {
  if (!view) return;
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  view.focus();
  contextVersion += 1;
}

async function copySelection(): Promise<void> {
  if (!view) return;
  const range = view.state.selection.main;
  if (range.empty) return;
  try {
    await writeClipboardText(view.state.sliceDoc(range.from, range.to));
    onCopy?.(true);
  } catch {
    onCopy?.(false);
  }
}

function runAtContext(command: (target: EditorView) => boolean): void {
  if (!view) return;
  command(view);
  view.focus();
  contextVersion += 1;
}

function captureContext(event: MouseEvent): void {
  if (!view) return;
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null) return;
  contextPosition = position;
  const selection = contextSelection(view.state, position);
  if (selection) view.dispatch({ selection });
  contextVersion += 1;
}

const menuItems = $derived.by<ContextMenuItem[]>(() => {
  void contextVersion;
  if (!view) return [];
  const selected = selectedSearchText(view.state, contextPosition);
  const hasSelection = !view.state.selection.main.empty;
  const canUnfold = canUnfoldAt(view.state, contextPosition);
  const canFold = !canUnfold && canFoldAt(view.state, contextPosition);
  return [
    {
      label: "Copy selection",
      icon: Copy,
      shortcut: viewerShortcut("c"),
      disabled: !hasSelection,
      onSelect: () => void copySelection(),
    },
    {
      label: "Select all",
      icon: TextSelect,
      shortcut: viewerShortcut("a"),
      onSelect: selectAllText,
    },
    { type: "separator" },
    {
      label: "Find",
      icon: Search,
      shortcut: viewerShortcut("f"),
      onSelect: () => openFind(false),
    },
    {
      label: "Find selection",
      icon: Search,
      disabled: !selected,
      onSelect: () => openFind(true),
    },
    { type: "separator" },
    {
      label: "Wrap long lines",
      icon: wrap ? Check : WrapText,
      disabled: !onToggleWrap,
      onSelect: onToggleWrap,
    },
    {
      label: "Highlight occurrences",
      icon: highlightSelectionMatches ? Check : ScanText,
      disabled: !onToggleSelectionMatches,
      onSelect: onToggleSelectionMatches,
    },
    { type: "separator" },
    {
      label: "Fold block",
      icon: FoldVertical,
      disabled: !canFold,
      onSelect: () => runAtContext(foldCode),
    },
    {
      label: "Unfold block",
      icon: UnfoldVertical,
      disabled: !canUnfold,
      onSelect: () => runAtContext(unfoldCode),
    },
    {
      label: "Fold all",
      icon: FoldVertical,
      shortcut: viewerShortcut("[", { alt: true }),
      onSelect: () => runAtContext(foldAll),
    },
    {
      label: "Unfold all",
      icon: UnfoldVertical,
      shortcut: viewerShortcut("]", { alt: true }),
      onSelect: () => runAtContext(unfoldAll),
    },
  ];
});

function baseExtensions(): Extension[] {
  return readOnlyCodeExtensions({
    lineStart,
    ariaLabel,
    highlightSelectionMatches,
    foldMarkerDOM: codeFoldMarker,
  });
}

function syncView(): void {
  if (!view) return;
  const current = view.state.doc.toString();
  if (current !== text) {
    view.dispatch({ changes: { from: 0, to: current.length, insert: text } });
  }
  view.dispatch({
    effects: [
      baseCompartment.reconfigure(baseExtensions()),
      wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []),
      targetCompartment.reconfigure(
        targetLineExtension(view.state, targetLine, lineStart),
      ),
    ],
  });
  updateFindStatus();
}

async function syncLanguage(nextLanguage: string | undefined): Promise<void> {
  const generation = ++languageGeneration;
  const extension = await loadCodeLanguage(nextLanguage);
  if (!view || generation !== languageGeneration || language !== nextLanguage)
    return;
  view.dispatch({ effects: languageCompartment.reconfigure(extension) });
}

onMount(() => {
  const state = EditorState.create({
    doc: text,
    extensions: [
      baseCompartment.of(baseExtensions()),
      languageCompartment.of([]),
      wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
      targetCompartment.of([]),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-a",
            run: () => {
              selectAllText();
              return true;
            },
          },
          {
            key: "Mod-f",
            run: () => {
              openFind();
              return true;
            },
          },
          {
            key: "F3",
            run: () => {
              moveMatch(false);
              return true;
            },
            shift: () => {
              moveMatch(true);
              return true;
            },
          },
          {
            key: "Mod-g",
            run: () => {
              moveMatch(false);
              return true;
            },
            shift: () => {
              moveMatch(true);
              return true;
            },
          },
          { key: "Mod-Shift-[", run: foldCode },
          { key: "Mod-Shift-]", run: unfoldCode },
          { key: "Mod-Alt-[", run: foldAll },
          { key: "Mod-Alt-]", run: unfoldAll },
          {
            key: "Escape",
            run: () => {
              if (!findOpen) return false;
              closeFind();
              return true;
            },
          },
        ]),
      ),
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) {
          contextVersion += 1;
          updateFindStatus();
        }
      }),
    ],
  });
  view = new EditorView({ state, parent: host });
  syncView();
  void syncLanguage(language);

  const localTarget = localLineNumber(targetLine, lineStart, state.doc.lines);
  if (localTarget) {
    view.dispatch({
      effects: EditorView.scrollIntoView(
        view.state.doc.line(localTarget).from,
        {
          y: "center",
        },
      ),
    });
  }
});

$effect(() => {
  void text;
  void lineStart;
  void targetLine;
  void wrap;
  void ariaLabel;
  void highlightSelectionMatches;
  syncView();
});

$effect(() => {
  void syncLanguage(language);
});

onDestroy(() => {
  languageGeneration += 1;
  view?.destroy();
});
</script>

<div
  class={`relative h-full min-h-0 min-w-0 overflow-hidden bg-background ${className}`}
  role="presentation"
>
  <ContextMenuList
    items={menuItems}
    triggerClass="block h-full min-h-0 min-w-0"
  >
    <div
      bind:this={host}
      class="h-full min-h-0 min-w-0"
      role="presentation"
      oncontextmenu={captureContext}
    ></div>
  </ContextMenuList>
  {#if findOpen}
    <CodeMirrorFindPanel
      query={findText}
      caseSensitive={findCaseSensitive}
      wholeWord={findWholeWord}
      regexp={findRegexp}
      status={findStatus}
      valid={findValid}
      onQueryChange={setFindText}
      onCaseSensitiveChange={(value) => setFindOption("case", value)}
      onWholeWordChange={(value) => setFindOption("word", value)}
      onRegexpChange={(value) => setFindOption("regexp", value)}
      onPrevious={() => moveMatch(true)}
      onNext={() => moveMatch(false)}
      onClose={closeFind}
    />
  {/if}
</div>
