<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
  children: Snippet;
};

let { children }: Props = $props();
</script>

<div class="divide-y divide-border overflow-hidden rounded-md border bg-card">
  {@render children()}
</div>
