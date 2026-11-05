<script lang="ts">
import { getChunks } from "@codemirror/merge";
import { type Extension, Prec, Text } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronUp from "@lucide/svelte/icons/chevron-up";
import Columns2 from "@lucide/svelte/icons/columns-2";
import Rows2 from "@lucide/svelte/icons/rows-2";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { untrack } from "svelte";
import CodeView from "./CodeView.svelte";
import {
  type DiffLayout,
  type DiffLineStats,
  type DiffPosition,
  diffChunkPosition,
  diffLineStats,
  stepDiffChunk,
} from "./code-diff";
import { loadCodeLanguage, loadedCodeLanguage } from "./code-mirror-config";

type Props = {
  original: string;
  modified: string;
  path: string;
  layout?: DiffLayout;
  wrap?: boolean;
  highlightSelectionMatches?: boolean;
  onLayoutChange?: (layout: DiffLayout) => void;
  onCopy?: (ok: boolean) => void;
  onToggleSelectionMatches?: () => void;
  onToggleWrap?: () => void;
};

let {
  original,
  modified,
  path,
  layout = "unified",
  wrap = false,
  highlightSelectionMatches = false,
  onLayoutChange,
  onCopy,
  onToggleSelectionMatches,
  onToggleWrap,
}: Props = $props();

/** Below this width a split diff is too cramped; it falls back to unified. */
const SPLIT_MIN_WIDTH = 720;

let view: EditorView | undefined;
let width = $state(0);
let position = $state<DiffPosition>({ total: 0 });
let stats = $state<DiffLineStats>({ added: 0, removed: 0 });
// Deletion widgets are built (and cached) with the language active at that
// moment, so the view mounts only once the parser for this path has loaded.
let languageReady = $state(untrack(() => Boolean(loadedCodeLanguage(path))));

const splitAvailable = $derived(width >= SPLIT_MIN_WIDTH);
const effectiveLayout = $derived<DiffLayout>(
  splitAvailable ? layout : "unified",
);
const originalDoc = $derived(Text.of(original.split(/\r\n|\r|\n/)));

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

function refresh(target: EditorView): void {
  position = diffChunkPosition(target.state);
  const chunks = getChunks(target.state)?.chunks ?? [];
  stats = diffLineStats(chunks, originalDoc, target.state.doc);
}

function step(direction: 1 | -1): void {
  if (!view) return;
  stepDiffChunk(view, direction);
  view.focus();
}

/* Stable for the life of the component: header state follows the modified
 * side, and change navigation is bound on top of the surface keymap. */
const extensions: Extension = [
  EditorView.updateListener.of((update) => {
    if (
      update.docChanged ||
      update.selectionSet ||
      getChunks(update.startState)?.chunks !== getChunks(update.state)?.chunks
    )
      refresh(update.view);
  }),
  Prec.highest(
    keymap.of([
      { key: "Alt-ArrowDown", run: (target) => stepDiffChunk(target, 1) },
      { key: "Alt-ArrowUp", run: (target) => stepDiffChunk(target, -1) },
      {
        key: "F7",
        run: (target) => stepDiffChunk(target, 1),
        shift: (target) => stepDiffChunk(target, -1),
      },
    ]),
  ),
];

function handleView(next: EditorView | undefined): void {
  view = next;
  if (!next) return;
  refresh(next);
  // Open on the first change instead of the top of a long file.
  requestAnimationFrame(() => {
    if (view === next && position.current === undefined) stepDiffChunk(next, 1);
  });
}

$effect(() => {
  void originalDoc;
  if (view) refresh(view);
});

const positionLabel = $derived(
  position.total === 0
    ? "No changes"
    : position.current
      ? `Change ${position.current} of ${position.total}`
      : `${position.total} ${position.total === 1 ? "change" : "changes"}`,
);
</script>

<div
  class="flex h-full min-h-0 min-w-0 flex-col bg-background"
  bind:clientWidth={width}
>
  <div
    class="flex h-control min-w-0 shrink-0 items-center gap-2 border-b border-border-subtle px-2 text-ui text-muted-foreground"
    role="toolbar"
    aria-label="Diff"
  >
    <span class="shrink-0 tabular-nums">
      <span class="text-success">+{stats.added}</span>
      <span class="ml-1 text-destructive">−{stats.removed}</span>
    </span>
    <span class="min-w-0 truncate tabular-nums" aria-live="polite"
      >{positionLabel}</span
    >
    <div class="ml-auto flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Previous change"
        title="Previous change (Alt+↑, Shift+F7)"
        disabled={position.total === 0}
        onclick={() => step(-1)}
      >
        <ChevronUp class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Next change"
        title="Next change (Alt+↓, F7)"
        disabled={position.total === 0}
        onclick={() => step(1)}
      >
        <ChevronDown class="size-3.5" />
      </Button>
      {#if onLayoutChange}
        <span class="mx-1 h-4 w-px bg-border" aria-hidden="true"></span>
        <ToggleGroup.Root
          type="single"
          variant="outline"
          size="sm"
          value={effectiveLayout}
          aria-label="Diff layout"
          onValueChange={(value) => {
            if (value === "unified" || value === "split") onLayoutChange(value);
          }}
        >
          <ToggleGroup.Item
            value="unified"
            aria-label="Unified diff"
            title="Unified"
          >
            <Rows2 />
          </ToggleGroup.Item>
          <ToggleGroup.Item
            value="split"
            aria-label="Side-by-side diff"
            title={splitAvailable
              ? "Side by side"
              : "Side by side needs a wider pane"}
            disabled={!splitAvailable}
          >
            <Columns2 />
          </ToggleGroup.Item>
        </ToggleGroup.Root>
      {/if}
    </div>
  </div>
  <div class="min-h-0 min-w-0 flex-1">
    <!-- Wait for the first width so a preferred split layout doesn't mount
         unified first and then remount. -->
    {#if languageReady && width > 0}
      {#key `${path}\u0000${effectiveLayout}`}
        <CodeView
          text={modified}
          diffOriginal={original}
          diffLayout={effectiveLayout}
          language={path}
          {wrap}
          {highlightSelectionMatches}
          {extensions}
          ariaLabel={`Diff for ${path}`}
          {onCopy}
          {onToggleSelectionMatches}
          {onToggleWrap}
          onView={handleView}
        />
      {/key}
    {/if}
  </div>
</div>
