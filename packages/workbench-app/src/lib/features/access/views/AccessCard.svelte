<script lang="ts">
import type { Snippet } from "svelte";
import KeyRound from "@lucide/svelte/icons/key-round";

type Props = {
  title: string;
  description?: string;
  children: Snippet;
  footer?: Snippet;
};

let { title, description, children, footer }: Props = $props();
</script>

<main
  class="flex min-h-full items-center justify-center bg-background p-4 text-foreground"
>
  <div
    class="grid w-full max-w-sm gap-5 rounded-lg border bg-card p-6 shadow-sm"
  >
    <div class="grid gap-2">
      <KeyRound class="size-5 text-primary" aria-hidden="true" />
      <h1 class="text-title font-medium">{title}</h1>
      {#if description}
        <p class="text-ui text-muted-foreground">{description}</p>
      {/if}
    </div>
    {@render children()}
    {#if footer}
      <div class="grid gap-2 border-t border-border-subtle pt-4">
        {@render footer()}
      </div>
    {/if}
  </div>
</main>
