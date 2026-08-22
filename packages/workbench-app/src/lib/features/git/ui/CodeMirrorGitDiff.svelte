<script lang="ts">
import { unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { onDestroy } from "svelte";
import {
  loadCodeLanguage,
  readOnlyCodeExtensions,
  shouldShowCodeMinimap,
} from "$lib/presentation/components/code";

type Props = {
  original: string;
  modified: string;
  path: string;
};

let { original, modified, path }: Props = $props();
let host = $state<HTMLElement | null>(null);
let view: EditorView | undefined;
let generation = 0;

const mergeTheme = EditorView.theme({
  "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: "color-mix(in oklab, var(--success) 10%, transparent)",
  },
  ".cm-deletedChunk": {
    color: "var(--foreground)",
    backgroundColor: "color-mix(in oklab, var(--destructive) 10%, transparent)",
  },
  "&.cm-merge-b .cm-changedText": {
    backgroundColor: "color-mix(in oklab, var(--success) 25%, transparent)",
  },
  "&.cm-merge-b .cm-deletedText, .cm-deletedChunk .cm-deletedText": {
    backgroundColor: "color-mix(in oklab, var(--destructive) 25%, transparent)",
  },
  ".cm-changedLineGutter": { backgroundColor: "var(--success)" },
  ".cm-deletedLineGutter": { backgroundColor: "var(--destructive-solid)" },
});

async function renderDiff(): Promise<void> {
  if (!host) return;
  const currentGeneration = ++generation;
  const language = await loadCodeLanguage(path);
  if (!host || currentGeneration !== generation) return;

  const state = EditorState.create({
    doc: modified,
    extensions: [
      ...readOnlyCodeExtensions({
        ariaLabel: `Diff for ${path}`,
        minimap: shouldShowCodeMinimap(modified, false),
      }),
      language,
      unifiedMergeView({
        original,
        gutter: true,
        highlightChanges: true,
        syntaxHighlightDeletions: true,
        allowInlineDiffs: true,
        mergeControls: false,
      }),
      mergeTheme,
    ],
  });

  view?.destroy();
  view = new EditorView({ state, parent: host });
}

$effect(() => {
  void original;
  void modified;
  void path;
  if (host) void renderDiff();
});

onDestroy(() => {
  generation += 1;
  view?.destroy();
});
</script>

<div bind:this={host} class="h-full min-h-0 min-w-0 overflow-hidden"></div>
