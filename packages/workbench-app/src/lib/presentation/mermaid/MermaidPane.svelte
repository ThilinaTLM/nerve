<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import MermaidDiagram from "@nervekit/ui-kit/renderers/mermaid/MermaidDiagram.svelte";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";

let {
  source,
  loading = false,
  error,
  truncated = false,
  ariaLabel = "Mermaid diagram",
}: {
  source?: string;
  loading?: boolean;
  error?: string;
  truncated?: boolean;
  ariaLabel?: string;
} = $props();
</script>

<section class="relative grid h-full min-h-0 min-w-0 bg-background">
  {#if loading && !source}
    <div
      class="grid min-h-72 place-items-center content-center gap-2 text-center text-muted-foreground"
    >
      <Spinner class="size-7 text-primary" />
      <strong class="text-foreground">Loading diagram</strong>
    </div>
  {:else if error}
    <div
      class="grid min-h-72 place-items-center content-center gap-2 p-4 text-center text-muted-foreground"
    >
      <TriangleAlert class="size-7 text-destructive" strokeWidth={1.7} />
      <strong class="text-foreground">Could not open diagram</strong>
      <p class="m-0 max-w-xl text-sm">{error}</p>
    </div>
  {:else if source}
    <MermaidDiagram
      class="h-full"
      {source}
      {ariaLabel}
      defaultWheelZoomEnabled
    />
    {#if truncated}
      <p
        class="absolute bottom-3 left-3 m-0 rounded-md border border-border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur-sm"
      >
        Preview loaded from a truncated file window.
      </p>
    {/if}
  {:else}
    <div
      class="grid min-h-72 place-items-center content-center gap-2 p-4 text-center text-muted-foreground"
    >
      <TriangleAlert class="size-7 text-destructive" strokeWidth={1.7} />
      <strong class="text-foreground">Diagram unavailable</strong>
      <p class="m-0 max-w-xl text-sm">
        The referenced Mermaid block could not be found.
      </p>
    </div>
  {/if}
</section>
