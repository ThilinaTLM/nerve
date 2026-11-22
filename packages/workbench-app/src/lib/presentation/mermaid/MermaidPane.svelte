<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import MermaidDiagram from "@nervekit/ui-kit/renderers/mermaid/MermaidDiagram.svelte";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { notifyCopyResult } from "@nervekit/ui-kit/browser/notifications";
import { FloatingNotice } from "@nervekit/ui-kit/components/composites/floating-toolbar";

let {
  source,
  loading = false,
  error,
  truncated = false,
  unsaved = false,
  ariaLabel = "Mermaid diagram",
  fileName,
}: {
  source?: string;
  loading?: boolean;
  error?: string;
  truncated?: boolean;
  /** The source is an unsaved draft. */
  unsaved?: boolean;
  ariaLabel?: string;
  /** Download name stem, e.g. the source file's name. */
  fileName?: string;
} = $props();
</script>

<section class="relative grid h-full min-h-0 min-w-0 bg-background">
  {#if loading && !source}
    <div
      class="grid min-h-72 place-items-center content-center gap-2 text-center text-muted-foreground"
    >
      <Spinner class="size-7 text-primary" />
      <strong class="font-medium text-foreground">Loading diagram</strong>
    </div>
  {:else if error}
    <div
      class="grid min-h-72 place-items-center content-center gap-2 p-4 text-center text-muted-foreground"
    >
      <TriangleAlert class="size-7 text-destructive" strokeWidth={1.7} />
      <strong class="font-medium text-foreground">Could not open diagram</strong
      >
      <p class="m-0 max-w-xl text-ui">{error}</p>
    </div>
  {:else if source}
    <MermaidDiagram
      class="h-full"
      {source}
      {ariaLabel}
      {fileName}
      defaultWheelZoomEnabled
      onCopy={(ok) => notifyCopyResult(ok, "Mermaid source")}
    >
      {#snippet notices()}
        {#if truncated}
          <FloatingNotice tone="warning"
            >Preview loaded from a truncated file window.</FloatingNotice
          >
        {/if}
        {#if unsaved}
          <FloatingNotice>Previewing unsaved changes.</FloatingNotice>
        {/if}
      {/snippet}
    </MermaidDiagram>
  {:else}
    <div
      class="grid min-h-72 place-items-center content-center gap-2 p-4 text-center text-muted-foreground"
    >
      <TriangleAlert class="size-7 text-destructive" strokeWidth={1.7} />
      <strong class="font-medium text-foreground">Diagram unavailable</strong>
      <p class="m-0 max-w-xl text-ui">
        The referenced Mermaid block could not be found.
      </p>
    </div>
  {/if}
</section>
