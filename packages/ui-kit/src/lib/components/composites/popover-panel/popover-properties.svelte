<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let { class: className, children }: { class?: string; children?: Snippet } =
  $props();
</script>

<dl class={cn("grid gap-1.5 text-xs", className)}>{@render children?.()}</dl>
