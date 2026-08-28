<script lang="ts">
import type { Snippet } from "svelte";
import { retainCenterTabScroll } from "./center-tab-scroll-restoration";

let {
  tabKey,
  hidden = false,
  children,
}: {
  tabKey: string;
  hidden?: boolean;
  children: Snippet;
} = $props();
</script>

<div
  use:retainCenterTabScroll={{ tabKey, active: !hidden }}
  class="size-full min-h-0 min-w-0"
  {hidden}
>
  {@render children()}
</div>
