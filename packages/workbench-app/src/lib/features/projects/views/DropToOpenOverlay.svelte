<script lang="ts">
import FolderOpen from "@lucide/svelte/icons/folder-open";
</script>

<div
  class="pointer-events-none fixed inset-2 z-50 grid place-items-center rounded-lg border-2 border-dashed border-primary bg-background/85"
  role="presentation"
  aria-hidden="true"
>
  <div class="flex flex-col items-center gap-1 text-center">
    <FolderOpen class="size-8 text-primary" />
    <span class="text-sm font-medium">Drop to open as a project</span>
    <span class="text-xs text-muted-foreground"
      >You'll confirm before anything opens</span
    >
  </div>
</div>
