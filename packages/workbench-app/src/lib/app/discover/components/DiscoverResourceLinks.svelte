<script lang="ts">
import ExternalLink from "@lucide/svelte/icons/external-link";
import { discoverResourceLinks } from "../content/resources.js";
</script>

<div
  class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground"
>
  {#each discoverResourceLinks as link (link.id)}
    <a
      class="inline-flex items-center gap-1 hover:text-foreground hover:underline"
      href={link.href}
      target="_blank"
      rel="noreferrer"
    >
      {link.label}
      <ExternalLink class="size-3" aria-hidden="true" />
    </a>
  {/each}
</div>
