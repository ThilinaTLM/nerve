<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  class?: string;
  start?: Snippet;
  end?: Snippet;
};

let { class: className, start, end }: Props = $props();
</script>

<div class={cn("flex flex-wrap items-center justify-between gap-2", className)}>
  <div class="flex min-w-0 flex-1 items-center gap-2">
    {#if start}
      {@render start()}
    {/if}
  </div>
  {#if end}
    <div class="flex flex-none flex-wrap items-center gap-2">
      {@render end()}
    </div>
  {/if}
</div>
