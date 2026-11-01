<script lang="ts">
import FolderOpen from "@lucide/svelte/icons/folder-open";

type Props = {
  /** A file drag is currently over the zone. */
  over: boolean;
  ondragover: (event: DragEvent) => void;
  ondragleave: (event: DragEvent) => void;
  ondrop: (event: DragEvent) => void;
};

let { over, ondragover, ondragleave, ondrop }: Props = $props();
</script>

<!-- Covers only the titlebar row (3rem, see WorkbenchFrame) so drags elsewhere
     stay free for the composer. `no-drag` lets the frameless desktop titlebar
     receive drop events. -->
<div
  class="fixed inset-x-0 top-0 z-50 h-12 bg-panel p-1.5 [-webkit-app-region:no-drag] animate-in fade-in-0 duration-150"
  role="region"
  aria-label="Drop to open as a project"
  {ondragover}
  {ondragleave}
  {ondrop}
>
  <div
    class={`pointer-events-none flex h-full items-center justify-center gap-2 rounded-md border-2 border-dashed text-ui transition-colors ${
      over
        ? "border-primary bg-primary/10 text-foreground"
        : "border-border text-muted-foreground"
    }`}
  >
    <FolderOpen class={`size-4 ${over ? "text-primary" : ""}`} />
    <span class="font-medium">Drop here to open as a project</span>
    <span class="text-ui text-muted-foreground max-md:hidden"
      >You'll confirm before anything opens</span
    >
  </div>
</div>
