<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let { class: className, children }: { class?: string; children?: Snippet } =
  $props();
</script>

<dl class={cn("grid grid-cols-1 gap-1 px-1.5 py-0.5 text-xs", className)}>
  {@render children?.()}
</dl>
