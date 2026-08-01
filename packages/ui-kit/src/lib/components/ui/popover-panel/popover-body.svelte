<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

let { class: className, children }: { class?: string; children?: Snippet } =
  $props();
</script>

<div class={cn("grid gap-3 p-3 text-xs", className)}>
  {@render children?.()}
</div>
