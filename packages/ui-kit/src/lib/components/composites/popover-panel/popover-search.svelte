<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

/** Pinned filter row between the header and the body. Holds one search input
 * (or a chip group that scopes the list); it never scrolls with the results. */
let { class: className, children }: { class?: string; children?: Snippet } =
  $props();
</script>

<div class={cn("flex-none px-2 pb-2", className)}>
  {@render children?.()}
</div>
