<script lang="ts">
import { VirtualScroller } from "@nervekit/ui-kit/components/composites/virtual-list";
import { segmentRawText } from "./tool-details-state";

type Props = { text: string; maxHeight?: string };
let { text, maxHeight = "22rem" }: Props = $props();
const items = $derived(segmentRawText(text));
</script>

<div style:--result-max-height={maxHeight}>
  <VirtualScroller
    {items}
    getKey={(item) => item.key}
    estimateSize={() => 18}
    viewportAriaLabel="Complete tool result"
    viewportTabIndex={0}
    viewportClass="max-h-(--result-max-height) rounded-sm border bg-well p-2 font-mono text-xs text-foreground"
  >
    {#snippet row({ item })}
      <div class="whitespace-pre-wrap break-all leading-[1.35]">
        {item.text}
      </div>
    {/snippet}
  </VirtualScroller>
</div>
