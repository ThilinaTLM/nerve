<script lang="ts">
import type { Snippet } from "svelte";
import type { Attachment } from "svelte/attachments";
import {
  PanelSplit,
  type PanelSplitArea,
  type PanelSplitLayout,
} from "@nervekit/ui-kit/components/composites/panel-split";
import { gitPanelLayout } from "../state/git-panel-view-state.svelte";

type Section = "branch" | "changes";
type Measure = Attachment<HTMLElement>;
type SectionProps = { open: boolean; toggle: () => void };
/**
 * `overflows`: the content is taller than the area's target height. Scroll
 * only then, so no scrollbar flashes while the height animates to fit.
 */
type MeasuredProps = { measure: Measure; overflows: boolean };

let {
  list,
  branch,
  changes,
}: {
  /** Without a list the two sections share the whole height. */
  list?: Snippet<[MeasuredProps]>;
  /** `measure` goes on the element holding the section body's natural content. */
  branch: Snippet<[SectionProps & MeasuredProps]>;
  changes: Snippet<[SectionProps]>;
} = $props();

/** One-line section header (`h-8`): the height of a collapsed section. */
const HEADER_PX = 32;

const LIST: PanelSplitArea = {
  id: "list",
  collapsible: false,
  // Smallest list while it has rows; it scrolls below its content.
  minPx: 56,
  fitContent: true,
  autoMaxShare: 0.5,
  resizeLabel: "Resize repository list",
};
const BRANCH: PanelSplitArea = {
  id: "branch",
  // Its header plus one line.
  minPx: HEADER_PX + 32,
  headerPx: HEADER_PX,
  autoMaxShare: 0.45,
  resizeLabel: "Resize selected branch",
};
const CHANGES: PanelSplitArea = {
  id: "changes",
  defaultCollapsed: true,
  minPx: 96,
  headerPx: HEADER_PX,
};

const stored = gitPanelLayout();
const areas = $derived(list ? [LIST, BRANCH, CHANGES] : [BRANCH, CHANGES]);
const layout = $derived<PanelSplitLayout>({
  collapsed: {
    branch: stored.branch.collapsed,
    changes: stored.changes.collapsed,
  },
  sizes: {
    ...(stored.listSize === null ? {} : { list: stored.listSize }),
    ...(stored.branch.size === null ? {} : { branch: stored.branch.size }),
  },
});

function onChange(next: PanelSplitLayout): void {
  stored.branch.collapsed = next.collapsed.branch ?? false;
  stored.changes.collapsed = next.collapsed.changes ?? true;
  stored.listSize = next.sizes.list ?? null;
  stored.branch.size = next.sizes.branch ?? null;
  stored.save();
}

let split = $state<ReturnType<typeof PanelSplit>>();
export function openSection(section: Section): void {
  split?.open(section);
}
</script>

<PanelSplit
  bind:this={split}
  {areas}
  {layout}
  {onChange}
  class="-mx-2"
  areaClass="px-2"
>
  {#snippet area({ area, open, toggle, measure, overflows })}
    {#if area.id === "list"}
      {@render list?.({ measure, overflows })}
    {:else if area.id === "branch"}
      {@render branch({ open, toggle, measure, overflows })}
    {:else}
      {@render changes({ open, toggle })}
    {/if}
  {/snippet}
</PanelSplit>
