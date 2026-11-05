<script lang="ts">
import {
  getOriginalDoc,
  unifiedMergeView,
  updateOriginalDoc,
} from "@codemirror/merge";
import { ChangeSet, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { untrack } from "svelte";
import CodeView from "./CodeView.svelte";
import { loadCodeLanguage, loadedCodeLanguage } from "./code-mirror-config";

type Props = {
  original: string;
  modified: string;
  path: string;
  wrap?: boolean;
  highlightSelectionMatches?: boolean;
  onCopy?: (ok: boolean) => void;
  onToggleSelectionMatches?: () => void;
  onToggleWrap?: () => void;
};

let {
  original,
  modified,
  path,
  wrap = false,
  highlightSelectionMatches = false,
  onCopy,
  onToggleSelectionMatches,
  onToggleWrap,
}: Props = $props();

const mergeTheme = EditorView.theme({
  "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: "var(--success-subtle)",
  },
  ".cm-deletedChunk": {
    color: "var(--foreground)",
    backgroundColor: "var(--destructive-subtle)",
  },
  "&.cm-merge-b .cm-changedText": {
    backgroundColor: "var(--success-strong)",
  },
  "&.cm-merge-b .cm-deletedText, .cm-deletedChunk .cm-deletedText": {
    backgroundColor: "var(--destructive-strong)",
  },
  ".cm-changeGutter": {
    width: "calc(3px + var(--spacing) * 0.5)",
    paddingLeft: "calc(var(--spacing) * 0.5)",
  },
  ".cm-changeGutter .cm-gutterElement": { padding: "0" },
  // Scoped to the change gutter so the active-line gutter can't override it.
  ".cm-changeGutter .cm-changedLineGutter": {
    backgroundColor: "var(--success)",
  },
  ".cm-changeGutter .cm-inlineChangedLineGutter": {
    backgroundColor: "var(--info)",
  },
  ".cm-changeGutter .cm-deletedLineGutter": {
    backgroundColor: "var(--destructive-solid)",
  },
});

let view: EditorView | undefined;
// Deletion widgets are built (and cached) with the language active at that
// moment, so the view mounts only once the parser for this path has loaded.
let languageReady = $state(untrack(() => Boolean(loadedCodeLanguage(path))));

$effect(() => {
  const current = path;
  if (loadedCodeLanguage(current)) {
    languageReady = true;
    return;
  }
  languageReady = false;
  void loadCodeLanguage(current).then(() => {
    if (path === current) languageReady = true;
  });
});

function mergeExtensions(initialOriginal: string): Extension {
  return [
    unifiedMergeView({
      original: initialOriginal,
      gutter: true,
      highlightChanges: true,
      syntaxHighlightDeletions: true,
      allowInlineDiffs: true,
      mergeControls: false,
      diffConfig: { scanLimit: 2_000, timeout: 500 },
    }),
    mergeTheme,
  ];
}

/* Built once per mounted view; later original-side refreshes go through
 * `updateOriginalDoc` so scroll, selection and folds survive. */
const extensions = $derived.by(() => {
  void path;
  return mergeExtensions(untrack(() => original));
});

$effect(() => {
  const next = original;
  if (!view) return;
  const current = getOriginalDoc(view.state);
  if (current.toString() === next) return;
  const doc = view.state.toText(next);
  view.dispatch({
    effects: updateOriginalDoc.of({
      doc,
      changes: ChangeSet.of(
        { from: 0, to: current.length, insert: doc },
        current.length,
      ),
    }),
  });
});
</script>

{#if languageReady}
  {#key path}
    <CodeView
      text={modified}
      language={path}
      {wrap}
      {highlightSelectionMatches}
      {extensions}
      ariaLabel={`Diff for ${path}`}
      {onCopy}
      {onToggleSelectionMatches}
      {onToggleWrap}
      onView={(next) => (view = next)}
    />
  {/key}
{:else}
  <div class="h-full bg-background" aria-busy="true"></div>
{/if}
