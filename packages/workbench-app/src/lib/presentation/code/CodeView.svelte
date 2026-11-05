<script lang="ts">
import { foldAll, foldCode, unfoldAll, unfoldCode } from "@codemirror/language";
import { MergeView } from "@codemirror/merge";
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
} from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { writeClipboardText } from "@nervekit/ui-kit/browser/clipboard";
import ContextMenuList from "@nervekit/ui-kit/components/composites/context-menu-list";
import { onDestroy, onMount, type Snippet, untrack } from "svelte";
import CodeGoToLinePanel from "./CodeGoToLinePanel.svelte";
import CodeMirrorFindPanel from "./CodeMirrorFindPanel.svelte";
import CodeStatusBar from "./CodeStatusBar.svelte";
import { CodeFindController } from "./code-find.svelte";
import {
  type CodeIndentation,
  detectIndentation,
  indentationExtension,
} from "./code-indentation";
import {
  codeDocumentLineSeparator,
  codeLanguageLabel,
  codeSurfaceExtensions,
  loadCodeLanguage,
  loadedCodeLanguage,
  localLineNumber,
} from "./code-mirror-config";
import {
  type DiffLayout,
  diffMergeConfig,
  splitDiffSideExtensions,
  unifiedDiffExtensions,
  updateUnifiedOriginal,
} from "./code-diff";
import { codeSurfaceMenuItems } from "./code-surface-menu";
import {
  unsavedChangesExtension,
  updateUnsavedChangesBaseline,
} from "./code-unsaved-changes";
import {
  contextSelection,
  copySelectedText,
  type CursorStatus,
  cursorStatus,
  type GoToLineTarget,
  goToLinePosition,
  minimalDocumentChange,
} from "./code-viewer-helpers";

type Props = {
  text: string;
  /** Language id or file path used to pick the parser. */
  language?: string;
  lineStart?: number;
  targetLine?: number;
  wrap?: boolean;
  ariaLabel?: string;
  class?: string;
  editable?: boolean;
  /** Temporarily blocks edits on an editable view (for example while busy). */
  disabled?: boolean;
  /** Saved text; enables the unsaved-change gutter on editable views. */
  originalText?: string;
  highlightSelectionMatches?: boolean;
  statusBar?: boolean;
  statusMessage?: Snippet;
  /** Extra extensions for the (modified) document. Reconfigured on change. */
  extensions?: Extension;
  /** Shows the document as a read-only diff against this original text. */
  diffOriginal?: string;
  /** Diff layout, fixed for the lifetime of the view (remount to change). */
  diffLayout?: DiffLayout;
  onCopy?: (ok: boolean) => void;
  onToggleSelectionMatches?: () => void;
  onToggleWrap?: () => void;
  onChange?: (text: string) => void;
  onSave?: () => void;
  onView?: (view: EditorView | undefined) => void;
};

let {
  text,
  language,
  lineStart = 1,
  targetLine,
  wrap = false,
  ariaLabel = "Code viewer",
  class: className = "",
  editable = false,
  disabled = false,
  originalText,
  highlightSelectionMatches = false,
  statusBar = false,
  statusMessage,
  extensions,
  diffOriginal,
  diffLayout = "unified",
  onCopy,
  onToggleSelectionMatches,
  onToggleWrap,
  onChange,
  onSave,
  onView,
}: Props = $props();

let host: HTMLElement;
let view = $state.raw<EditorView | undefined>();
/** Split diffs: the merge view whose `b` side is `view`. */
let merge: MergeView | undefined;
/** The side a context menu was opened on (split diffs have two). */
let contextView = $state.raw<EditorView | undefined>();
let languageGeneration = 0;
let contextPosition = $state(0);
let contextVersion = $state(0);
let goToLineOpen = $state(false);
let cursor = $state<CursorStatus>({
  line: 1,
  column: 1,
  selections: 1,
  selectedLength: 0,
});
let indentation = $state<CodeIndentation>(detectIndentation(""));
let lineEnding = $state("LF");

const find = new CodeFindController(() => view);
const canEdit = $derived(editable && !disabled);

const baseCompartment = new Compartment();
const lineSeparatorCompartment = new Compartment();
const languageCompartment = new Compartment();
const wrapCompartment = new Compartment();
const targetCompartment = new Compartment();
const unsavedCompartment = new Compartment();
const indentationCompartment = new Compartment();
const extraCompartment = new Compartment();
const diffCompartment = new Compartment();
const originalBaseCompartment = new Compartment();
const originalLineSeparatorCompartment = new Compartment();
// The layout is fixed per mount; parents remount to switch it.
const split = untrack(
  () => diffOriginal !== undefined && diffLayout === "split",
);

// Values installed in CodeMirror, compared to skip redundant reconfigures.
let installedLineSeparator: string | undefined;
let installedBaseline: string | undefined;
let installedExtensions: Extension | undefined;
let installedOriginal: string | undefined;
/** The last text this view reported through onChange; when the parent echoes
 * it back as `text`, the document already matches and no diff is needed. */
let emittedText: string | undefined;

function lineSeparatorExtension(separator: string | undefined): Extension {
  return separator ? EditorState.lineSeparator.of(separator) : [];
}

function lineEndingLabel(separator: string | undefined): string {
  if (separator === "\r\n") return "CRLF";
  if (separator === "\r") return "CR";
  return "LF";
}

function targetLineExtension(state: EditorState): Extension {
  const local = localLineNumber(targetLine, lineStart, state.doc.lines);
  if (!local) return [];
  return EditorView.decorations.of(
    Decoration.set([
      Decoration.line({ class: "cm-target-line" }).range(
        state.doc.line(local).from,
      ),
    ]),
  );
}

function baseExtensions(): Extension[] {
  return codeSurfaceExtensions({
    ariaLabel,
    editable: canEdit,
    lineStart,
    highlightSelectionMatches,
    scrollPastEnd: !split,
  });
}

function originalBaseExtensions(): Extension[] {
  return codeSurfaceExtensions({
    ariaLabel: `Original: ${ariaLabel}`,
    highlightSelectionMatches,
    scrollPastEnd: false,
    overviewRuler: false,
  });
}

/** Every editor this component owns: one, or both sides of a split diff. */
function allViews(): EditorView[] {
  if (merge) return [merge.a, merge.b];
  return view ? [view] : [];
}

function diffExtensions(): Extension {
  if (diffOriginal === undefined) return [];
  return split
    ? splitDiffSideExtensions()
    : diffCompartment.of(unifiedDiffExtensions(diffOriginal));
}

function unsavedExtension(baseline: string | undefined): Extension {
  return baseline === undefined ? [] : unsavedChangesExtension(baseline);
}

function activeBaseline(): string | undefined {
  return editable ? originalText : undefined;
}

async function copyText(value: string): Promise<void> {
  try {
    await writeClipboardText(value);
    onCopy?.(true);
  } catch {
    onCopy?.(false);
  }
}

function copySelection(): boolean {
  const target = contextView ?? view;
  if (!target) return false;
  return copySelectedText(target.state, (selected) => void copyText(selected));
}

function selectAll(): void {
  const target = contextView ?? view;
  if (!target) return;
  target.dispatch({ selection: { anchor: 0, head: target.state.doc.length } });
  target.focus();
}

function runCommand(command: (target: EditorView) => boolean): void {
  const target = contextView ?? view;
  if (!target) return;
  command(target);
  target.focus();
  contextVersion += 1;
}

function openFind(
  options: { seed?: boolean; replace?: boolean; position?: number } = {},
): void {
  goToLineOpen = false;
  find.show({
    seed: options.seed ?? true,
    position: options.position,
    replace: canEdit && (options.replace ?? find.replaceOpen),
  });
}

function openGoToLine(): void {
  if (!view) return;
  if (find.open) find.close();
  cursor = cursorStatus(view.state, lineStart);
  goToLineOpen = true;
}

function closeGoToLine(): void {
  goToLineOpen = false;
  requestAnimationFrame(() => view?.focus());
}

function goToLine(target: GoToLineTarget): void {
  if (!view) return;
  const position = goToLinePosition(view.state, target, lineStart);
  view.dispatch({
    selection: EditorSelection.cursor(position),
    effects: EditorView.scrollIntoView(position, { y: "center" }),
  });
  closeGoToLine();
}

function stepMatch(previous: boolean): boolean {
  if (!find.query) {
    openFind();
    return true;
  }
  if (previous) find.previous();
  else find.next();
  return true;
}

function captureContext(event: MouseEvent): void {
  const target =
    merge && event.target instanceof Node && merge.a.dom.contains(event.target)
      ? merge.a
      : view;
  if (!target) return;
  const position = target.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null) return;
  contextView = target;
  contextPosition = position;
  const selection = contextSelection(target.state, position);
  if (selection) target.dispatch({ selection });
  contextVersion += 1;
}

const menuItems = $derived.by(() => {
  void contextVersion;
  const menuView = contextView ?? view;
  if (!menuView) return [];
  return codeSurfaceMenuItems({
    view: menuView,
    position: contextPosition,
    editable: canEdit,
    wrap,
    highlightSelectionMatches,
    onSave,
    onCopySelection: () => void copySelection(),
    onSelectAll: selectAll,
    onFind: (options) => openFind({ ...options, position: contextPosition }),
    onGoToLine: openGoToLine,
    onToggleWrap,
    onToggleSelectionMatches,
    run: runCommand,
  });
});

function surfaceKeymap(): Extension {
  return Prec.highest(
    keymap.of([
      {
        key: "Mod-s",
        run: () => {
          if (!canEdit || !onSave) return false;
          onSave();
          return true;
        },
      },
      {
        key: "Mod-c",
        // Editable views keep CodeMirror's copy (multi-cursor, whole line).
        run: (target) =>
          !target.state.readOnly
            ? false
            : copySelectedText(
                target.state,
                (selected) => void copyText(selected),
              ),
      },
      {
        key: "Mod-f",
        run: () => {
          openFind({ replace: false });
          return true;
        },
      },
      {
        key: "Mod-h",
        mac: "Mod-Alt-f",
        run: () => {
          if (!canEdit) return false;
          openFind({ replace: true });
          return true;
        },
      },
      {
        key: "Ctrl-g",
        run: () => {
          openGoToLine();
          return true;
        },
      },
      {
        mac: "Mod-g",
        run: () => stepMatch(false),
        shift: () => stepMatch(true),
      },
      {
        key: "F3",
        run: () => stepMatch(false),
        shift: () => stepMatch(true),
      },
      { key: "Mod-Shift-[", run: foldCode },
      { key: "Mod-Shift-]", run: unfoldCode },
      { key: "Mod-Alt-[", run: foldAll },
      { key: "Mod-Alt-]", run: unfoldAll },
      {
        key: "Escape",
        run: () => {
          if (goToLineOpen) {
            closeGoToLine();
            return true;
          }
          if (!find.open) return false;
          find.close();
          return true;
        },
      },
    ]),
  );
}

function syncDocument(): void {
  if (!view || text === emittedText) return;
  const separator = codeDocumentLineSeparator(text);
  if (installedLineSeparator !== separator) {
    view.dispatch({
      effects: lineSeparatorCompartment.reconfigure(
        lineSeparatorExtension(separator),
      ),
    });
    installedLineSeparator = separator;
    lineEnding = lineEndingLabel(separator);
  }
  const change = minimalDocumentChange(view.state.doc, view.state.toText(text));
  if (change) {
    view.dispatch({ changes: change });
    emittedText = undefined;
  }
  syncIndentation();
}

function syncIndentation(): void {
  if (!view) return;
  const next = detectIndentation(text);
  if (next.unit === indentation.unit && next.tabSize === indentation.tabSize)
    return;
  indentation = next;
  for (const target of allViews())
    target.dispatch({
      effects: indentationCompartment.reconfigure(indentationExtension(next)),
    });
}

function syncConfiguration(): void {
  if (!view) return;
  view.dispatch({
    effects: [
      baseCompartment.reconfigure(baseExtensions()),
      wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []),
      targetCompartment.reconfigure(targetLineExtension(view.state)),
    ],
  });
  merge?.a.dispatch({
    effects: [
      originalBaseCompartment.reconfigure(originalBaseExtensions()),
      wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []),
    ],
  });
  find.scheduleRefresh();
}

function syncDiffOriginal(): void {
  if (!view || diffOriginal === undefined || diffOriginal === installedOriginal)
    return;
  installedOriginal = diffOriginal;
  if (!merge) {
    updateUnifiedOriginal(view, diffOriginal);
    return;
  }
  const original = merge.a;
  original.dispatch({
    effects: originalLineSeparatorCompartment.reconfigure(
      lineSeparatorExtension(codeDocumentLineSeparator(diffOriginal)),
    ),
  });
  const change = minimalDocumentChange(
    original.state.doc,
    original.state.toText(diffOriginal),
  );
  if (change) original.dispatch({ changes: change });
}

function syncUnsavedChanges(): void {
  if (!view) return;
  const next = activeBaseline();
  if (next === installedBaseline) return;
  if (next === undefined || installedBaseline === undefined) {
    view.dispatch({
      effects: unsavedCompartment.reconfigure(unsavedExtension(next)),
    });
  } else {
    view.dispatch({
      effects: updateUnsavedChangesBaseline(view.state, next),
    });
  }
  installedBaseline = next;
}

function syncExtensions(): void {
  if (!view || extensions === installedExtensions) return;
  view.dispatch({
    effects: extraCompartment.reconfigure(extensions ?? []),
  });
  installedExtensions = extensions;
}

async function syncLanguage(nextLanguage: string | undefined): Promise<void> {
  const generation = ++languageGeneration;
  const extension = await loadCodeLanguage(nextLanguage);
  if (!view || generation !== languageGeneration || language !== nextLanguage)
    return;
  for (const target of allViews())
    target.dispatch({ effects: languageCompartment.reconfigure(extension) });
}

onMount(() => {
  installedLineSeparator = codeDocumentLineSeparator(text);
  lineEnding = lineEndingLabel(installedLineSeparator);
  installedBaseline = activeBaseline();
  installedExtensions = extensions;
  indentation = detectIndentation(text);

  installedOriginal = diffOriginal;
  const modifiedExtensions: Extension[] = [
    baseCompartment.of(baseExtensions()),
    lineSeparatorCompartment.of(lineSeparatorExtension(installedLineSeparator)),
    languageCompartment.of(loadedCodeLanguage(language) ?? []),
    wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
    targetCompartment.of([]),
    unsavedCompartment.of(unsavedExtension(installedBaseline)),
    indentationCompartment.of(indentationExtension(indentation)),
    extraCompartment.of(installedExtensions ?? []),
    diffExtensions(),
    surfaceKeymap(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && onChange) {
        emittedText = update.state.sliceDoc();
        onChange(emittedText);
      }
      if (update.docChanged || update.selectionSet) {
        if (statusBar) cursor = cursorStatus(update.state, lineStart);
        find.scheduleRefresh();
      }
    }),
  ];
  if (split && diffOriginal !== undefined) {
    const originalSeparator = codeDocumentLineSeparator(diffOriginal);
    merge = new MergeView({
      ...diffMergeConfig,
      parent: host,
      a: {
        doc: diffOriginal,
        extensions: [
          originalBaseCompartment.of(originalBaseExtensions()),
          originalLineSeparatorCompartment.of(
            lineSeparatorExtension(originalSeparator),
          ),
          languageCompartment.of(loadedCodeLanguage(language) ?? []),
          wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
          indentationCompartment.of(indentationExtension(indentation)),
          splitDiffSideExtensions(),
          surfaceKeymap(),
        ],
      },
      b: { doc: text, extensions: modifiedExtensions },
    });
    // Both sides scroll together inside the merge container.
    merge.dom.style.height = "100%";
    merge.dom.style.overflow = "auto";
    view = merge.b;
  } else {
    view = new EditorView({
      state: EditorState.create({ doc: text, extensions: modifiedExtensions }),
      parent: host,
    });
  }
  const state = view.state;
  onView?.(view);
  syncConfiguration();
  if (statusBar) cursor = cursorStatus(view.state, lineStart);
  void syncLanguage(language);

  const localTarget = localLineNumber(targetLine, lineStart, state.doc.lines);
  if (localTarget) {
    view.dispatch({
      effects: EditorView.scrollIntoView(
        view.state.doc.line(localTarget).from,
        { y: "center" },
      ),
    });
  }
});

$effect(() => {
  void text;
  syncDocument();
});

$effect(() => {
  void lineStart;
  void targetLine;
  void wrap;
  void ariaLabel;
  void highlightSelectionMatches;
  void canEdit;
  syncConfiguration();
});

$effect(() => {
  void editable;
  void originalText;
  syncUnsavedChanges();
});

$effect(() => {
  void extensions;
  syncExtensions();
});

$effect(() => {
  void diffOriginal;
  syncDiffOriginal();
});

$effect(() => {
  void syncLanguage(language);
});

onDestroy(() => {
  languageGeneration += 1;
  find.dispose();
  onView?.(undefined);
  if (merge) merge.destroy();
  else view?.destroy();
});
</script>

<div
  class={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background ${className}`}
  role="presentation"
>
  <div class="relative min-h-0 min-w-0 flex-1">
    <ContextMenuList
      items={menuItems}
      triggerClass="block h-full min-h-0 min-w-0"
      nativeTouch
    >
      <div
        bind:this={host}
        class="relative h-full min-h-0 min-w-0"
        role="presentation"
        oncontextmenu={captureContext}
      ></div>
    </ContextMenuList>
    {#if find.open}
      <CodeMirrorFindPanel
        query={find.query}
        caseSensitive={find.caseSensitive}
        wholeWord={find.wholeWord}
        regexp={find.regexp}
        status={find.status}
        valid={find.valid}
        focusRequest={find.focusRequest}
        canReplace={canEdit}
        replaceOpen={find.replaceOpen}
        replacement={find.replacement}
        onQueryChange={(value) => find.setQuery(value)}
        onCaseSensitiveChange={(value) => find.setOption("case", value)}
        onWholeWordChange={(value) => find.setOption("word", value)}
        onRegexpChange={(value) => find.setOption("regexp", value)}
        onPrevious={() => find.previous()}
        onNext={() => find.next()}
        onClose={() => find.close()}
        onReplaceOpenChange={(open) => (find.replaceOpen = open)}
        onReplacementChange={(value) => find.setReplacement(value)}
        onReplace={() => find.replaceNext()}
        onReplaceAll={() => find.replaceAll()}
      />
    {:else if goToLineOpen && view}
      <CodeGoToLinePanel
        currentLine={cursor.line}
        firstLine={lineStart}
        lastLine={lineStart + view.state.doc.lines - 1}
        onGo={goToLine}
        onClose={closeGoToLine}
      />
    {/if}
  </div>
  {#if statusBar}
    <CodeStatusBar
      {cursor}
      indentation={indentation.label}
      {lineEnding}
      language={codeLanguageLabel(language)}
      message={statusMessage}
      onGoToLine={openGoToLine}
    />
  {/if}
</div>
