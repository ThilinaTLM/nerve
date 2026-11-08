<script lang="ts">
import type { Snippet } from "svelte";
import * as Resizable from "@nervekit/ui-kit/components/ui/resizable";
import { cn } from "@nervekit/ui-kit/utils";
import { gitPanelLayout } from "../state/git-panel-view-state.svelte";

type Section = "branch" | "changes";
type SectionSnippetProps = { open: boolean; toggle: () => void };
type PaneHandle = { resize(size: number): void; getSize(): number };

let {
  list,
  branch,
  changes,
}: {
  list: Snippet;
  branch: Snippet<[SectionSnippetProps]>;
  changes: Snippet<[SectionSnippetProps]>;
} = $props();

/** One-line section header (`h-8`), the size of a collapsed section. */
const HEADER_PX = 32;
const MIN_LIST = 20;
const ANIMATION_MS = 200;

const layout = gitPanelLayout();
let groupHeight = $state(0);
/** Panes are sized in percent, so the collapsed size follows the panel height. */
const headerPct = $derived(groupHeight ? (HEADER_PX / groupHeight) * 100 : 5);
let listPane = $state<PaneHandle>();
let branchPane = $state<PaneHandle>();
let changesPane = $state<PaneHandle>();
let animating = $state(false);
let animationTimer: ReturnType<typeof setTimeout> | undefined;

const handles = (section: Section) =>
  section === "branch" ? branchPane : changesPane;

/** Open sizes at mount: sections take space from the list, never below its minimum. */
function initialSizes(): { branch: number; changes: number; list: number } {
  let branchSize = layout.branch.collapsed ? headerPct : layout.branch.size;
  let changesSize = layout.changes.collapsed ? headerPct : layout.changes.size;
  const overflow = branchSize + changesSize + MIN_LIST - 100;
  if (overflow > 0) {
    const open = [
      layout.branch.collapsed ? 0 : branchSize - headerPct,
      layout.changes.collapsed ? 0 : changesSize - headerPct,
    ];
    const total = open[0]! + open[1]!;
    if (total > 0) {
      branchSize -= (overflow * open[0]!) / total;
      changesSize -= (overflow * open[1]!) / total;
    }
  }
  return {
    branch: branchSize,
    changes: changesSize,
    list: 100 - branchSize - changesSize,
  };
}
let initial = $state<ReturnType<typeof initialSizes>>();
$effect(() => {
  if (groupHeight > 0 && !initial) initial = initialSizes();
});

function remember(section: Section, size: number): void {
  const open = size > headerPct + 1;
  const target = layout[section];
  if (
    open === !target.collapsed &&
    (!open || Math.abs(target.size - size) < 0.1)
  )
    return;
  target.collapsed = !open;
  if (open) target.size = size;
  layout.save();
}

/** Moves a section to `target` percent; the list gives or takes the space. */
function setSize(section: Section, target: number): void {
  const pane = handles(section);
  if (!listPane || !branchPane || !pane) return;
  const size = pane.getSize();
  const delta = target - size;
  if (Math.abs(delta) < 0.01) return;
  if (section === "branch") {
    listPane.resize(listPane.getSize() - delta);
  } else if (delta > 0) {
    // Growing: the list shrinks first so the branch section keeps its size.
    listPane.resize(listPane.getSize() - delta);
    pane.resize(target);
  } else {
    pane.resize(target);
    listPane.resize(listPane.getSize() - delta);
  }
}

/** Header-driven open/close animates; dragging a divider never does. */
function toggle(section: Section): void {
  const pane = handles(section);
  if (!pane) return;
  animating = true;
  clearTimeout(animationTimer);
  animationTimer = setTimeout(() => (animating = false), ANIMATION_MS + 40);
  const size = pane.getSize();
  if (size > headerPct + 1) {
    layout[section].size = size;
    setSize(section, headerPct);
  } else {
    // Never take more than the list can give; the other section is untouched.
    const room = (listPane?.getSize() ?? 0) - MIN_LIST + size;
    setSize(section, Math.max(headerPct, Math.min(layout[section].size, room)));
  }
}

export function openSection(section: Section): void {
  const pane = handles(section);
  if (pane && pane.getSize() <= headerPct + 1) toggle(section);
}

// A new panel height changes the pixel header's share: refit collapsed sections.
$effect(() => {
  const pct = headerPct;
  if (!initial) return;
  for (const section of ["branch", "changes"] as const) {
    const pane = handles(section);
    if (
      pane &&
      layout[section].collapsed &&
      Math.abs(pane.getSize() - pct) > 0.05
    )
      setSize(section, pct);
  }
});

$effect(() => () => clearTimeout(animationTimer));
</script>

<div class="-mx-2 flex min-h-0 flex-1 flex-col" bind:clientHeight={groupHeight}>
  {#if initial}
    <Resizable.PaneGroup
      direction="vertical"
      class={cn(
        "min-h-0 flex-1",
        animating &&
          "[&>[data-pane]]:transition-[flex-grow] [&>[data-pane]]:duration-200 [&>[data-pane]]:ease-out motion-reduce:[&>[data-pane]]:transition-none",
      )}
    >
      <Resizable.Pane
        bind:this={listPane}
        defaultSize={initial.list}
        minSize={MIN_LIST}
        class="px-2"
      >
        {@render list()}
      </Resizable.Pane>
      <Resizable.Handle
        aria-label="Resize repository list"
        class="data-[direction=vertical]:after:h-2"
      />
      <Resizable.Pane
        bind:this={branchPane}
        defaultSize={initial.branch}
        minSize={18}
        collapsible
        collapsedSize={headerPct}
        onResize={(size) => remember("branch", size)}
        class="px-2"
      >
        {@render branch({
          open: !layout.branch.collapsed,
          toggle: () => toggle("branch"),
        })}
      </Resizable.Pane>
      <Resizable.Handle
        aria-label="Resize selected branch"
        class="data-[direction=vertical]:after:h-2"
      />
      <Resizable.Pane
        bind:this={changesPane}
        defaultSize={initial.changes}
        minSize={18}
        collapsible
        collapsedSize={headerPct}
        onResize={(size) => remember("changes", size)}
        class="px-2"
      >
        {@render changes({
          open: !layout.changes.collapsed,
          toggle: () => toggle("changes"),
        })}
      </Resizable.Pane>
    </Resizable.PaneGroup>
  {/if}
</div>
