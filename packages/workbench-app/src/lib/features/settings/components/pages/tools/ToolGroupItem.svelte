<script lang="ts">
import type { Snippet } from "svelte";
import { SettingsDisclosureItem } from "$lib/presentation/components/settings";

type Props = {
  title: string;
  description: string;
  tools: { name: string; description: string }[];
  actions: Snippet;
  extra?: Snippet;
};

let {
  title,
  description,
  tools,
  actions: actionContent,
  extra,
}: Props = $props();
</script>

<SettingsDisclosureItem {title} {description}>
  {#snippet actions()}
    {@render actionContent()}
  {/snippet}
  {#snippet detail()}
    <ul class="grid gap-1" aria-label={`${title} tools`}>
      {#each tools as tool (tool.name)}
        <li class="min-w-0">
          <span class="font-mono text-foreground">{tool.name}</span>
          <span> — {tool.description}</span>
        </li>
      {/each}
    </ul>
    {#if extra}
      {@render extra()}
    {/if}
  {/snippet}
</SettingsDisclosureItem>
