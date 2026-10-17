<script lang="ts">
// One sheet section per diff (edit operation): optional caption, then the diff
// flush in the sheet. Sections are keyed by argument index, so a section keeps
// its element from the first streamed byte to the recorded result.
import { untrack } from "svelte";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { cn } from "@nervekit/ui-kit/utils";
import { COLLAPSED_LINES } from "../views/tool-view-helpers";
import SlotText from "../../cards/SlotText.svelte";
import ResultCodeBlock from "./ResultCodeBlock.svelte";
import { getToolMotion } from "./tool-motion-context";

export type DiffSection = {
  key: string;
  caption?: string;
  text?: string;
  status?: "failed" | "not_applied";
};

type Props = {
  sections: DiffSection[];
  tail?: boolean;
  fixedRows?: number;
  streaming?: boolean;
};
let {
  sections,
  tail = false,
  fixedRows = COLLAPSED_LINES,
  streaming = false,
}: Props = $props();

const toolMotion = getToolMotion();
const streamMotion = $derived(streaming && toolMotion.streamMotion);
// Sections present at mount never enter, so remounts do not replay.
const initialCount = untrack(() => sections.length);

const skeletonWidths = ["w-11/12", "w-3/4", "w-5/6"];
</script>

{#each sections as section, index (section.key)}
  <div
    class={cn(
      "grid min-w-0 gap-1 px-2.5 py-2",
      streamMotion && index >= initialCount && "stream-item-enter",
    )}
  >
    {#if section.caption !== undefined || section.status}
      <p
        class={cn(
          "m-0 text-xs font-medium wrap-anywhere",
          section.status === "failed"
            ? "text-destructive"
            : "text-muted-foreground",
        )}
      >
        {#if section.caption}<SlotText
            text={section.caption}
            {streaming}
          />{/if}{#if section.status === "failed"}<span>
            {section.caption ? " · " : ""}failed</span
          >{:else if section.status === "not_applied"}<span class="font-normal">
            {section.caption ? " · " : ""}not applied</span
          >{/if}
      </p>
    {/if}
    {#if section.text === undefined}
      <div class="grid gap-1.5 py-0.5">
        {#each skeletonWidths as width (width)}
          <Skeleton class={cn("h-2.5 rounded-sm bg-foreground/10", width)} />
        {/each}
      </div>
    {:else}
      <ResultCodeBlock
        code={section.text}
        language="diff"
        trim={false}
        highlight={false}
        wrap
        overflow="hidden"
        {tail}
        {fixedRows}
        live={streaming}
        caret={streaming}
        {streamMotion}
      />
    {/if}
  </div>
{/each}
