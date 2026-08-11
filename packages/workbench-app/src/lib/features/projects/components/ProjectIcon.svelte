<script lang="ts">
import Layers from "@lucide/svelte/icons/layers";
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  projectId: string;
  class?: string;
};

let { projectId, class: className }: Props = $props();
let failed = $state(false);
const source = $derived(
  `/api/projects/${encodeURIComponent(projectId)}/icon?v=2`,
);
</script>

<span
  class={cn(
    "relative grid shrink-0 place-items-center overflow-hidden rounded-md border border-border/60 bg-muted/40 text-muted-foreground",
    className,
  )}
  aria-hidden="true"
>
  <Layers class="size-1/2" strokeWidth={1.8} />
  {#if !failed}
    <img
      src={source}
      alt=""
      loading="lazy"
      decoding="async"
      class="absolute inset-0 size-full bg-muted/40 object-cover"
      onerror={() => (failed = true)}
    />
  {/if}
</span>
