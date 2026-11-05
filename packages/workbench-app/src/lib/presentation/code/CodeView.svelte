<script lang="ts">
import { foldAll, foldCode, unfoldAll, unfoldCode } from "@codemirror/language";
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
import { onDestroy, onMount, type Snippet } from "svelte";
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
  /** Extra extensions (for example a merge view). Reconfigured on change. */
  extensions?: Extension;
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
  onCopy,
  onToggleSelectionMatches,
  onToggleWrap,
  onChange,
  onSave,
  onView,
}: Props = $props();

let host: HTMLElement;
let view = $state.raw<EditorView | undefined>();
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

// Values installed in CodeMirror, compared to skip redundant reconfigures.
let installedLineSeparator: string | undefined;
let installedBaseline: string | undefined;
let installedExtensions: Extension | undefined;
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
  });
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
  if (!view) return false;
  return copySelectedText(view.state, (selected) => void copyText(selected));
}

function selectAll(): void {
  if (!view) return;
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  view.focus();
}

function runCommand(command: (target: EditorView) => boolean): void {
  if (!view) return;
  command(view);
  view.focus();
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
  if (!view) return;
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null) return;
  contextPosition = position;
  const selection = contextSelection(view.state, position);
  if (selection) view.dispatch({ selection });
  contextVersion += 1;
}

const menuItems = $derived.by(() => {
  void contextVersion;
  if (!view) return [];
  return codeSurfaceMenuItems({
    view,
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
  view.dispatch({
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
  find.scheduleRefresh();
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
  view.dispatch({ effects: languageCompartment.reconfigure(extension) });
}

onMount(() => {
  installedLineSeparator = codeDocumentLineSeparator(text);
  lineEnding = lineEndingLabel(installedLineSeparator);
  installedBaseline = activeBaseline();
  installedExtensions = extensions;
  indentation = detectIndentation(text);

  const state = EditorState.create({
    doc: text,
    extensions: [
      baseCompartment.of(baseExtensions()),
      lineSeparatorCompartment.of(
        lineSeparatorExtension(installedLineSeparator),
      ),
      languageCompartment.of(loadedCodeLanguage(language) ?? []),
      wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
      targetCompartment.of([]),
      unsavedCompartment.of(unsavedExtension(installedBaseline)),
      indentationCompartment.of(indentationExtension(indentation)),
      extraCompartment.of(installedExtensions ?? []),
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
    ],
  });
  view = new EditorView({ state, parent: host });
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
  void syncLanguage(language);
});

onDestroy(() => {
  languageGeneration += 1;
  find.dispose();
  onView?.(undefined);
  view?.destroy();
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
        class="h-full min-h-0 min-w-0"
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
