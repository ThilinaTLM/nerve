<script lang="ts">
import type { Snippet } from "svelte";
import ToolSections from "./ToolSections.svelte";

type Props = {
  children?: Snippet;
};

let { children }: Props = $props();
</script>

<ToolSections>
  {#if children}{@render children()}{/if}
</ToolSections>
