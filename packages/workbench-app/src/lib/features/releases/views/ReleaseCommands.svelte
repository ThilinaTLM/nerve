<!--
  @component
  The commands that run the latest release, or pin the given one, each with
  Copy. Shared by the titlebar's Update popover and Settings › About.
-->
<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import Copy from "@lucide/svelte/icons/copy";
import { onDestroy } from "svelte";
import { scale } from "svelte/transition";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";

let { version }: { version: string } = $props();

const commands = $derived([
  {
    id: "latest",
    label: "Latest release",
    command: "npx @nervekit/desktop@latest",
  },
  {
    id: "pinned",
    label: "Pinned release",
    command: `npx @nervekit/desktop@${version}`,
  },
]);

let copied = $state<string>();
let resetTimer: ReturnType<typeof setTimeout> | undefined;

async function copy(id: string, command: string): Promise<void> {
  try {
    await writeClipboardText(command);
  } catch {
    return;
  }
  copied = id;
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => (copied = undefined), 1_500);
}

onDestroy(() => clearTimeout(resetTimer));
</script>

<div class="grid gap-1">
  {#each commands as entry, index (entry.id)}
    {#if index === 1}
      <span class="mt-1 px-1.5 text-ui text-muted-foreground"
        >Or pin this release</span
      >
    {/if}
    <div class="flex items-center rounded-sm bg-muted pr-1 pl-2">
      <code
        class="min-w-0 flex-1 py-1.5 font-mono text-ui text-foreground select-text"
        >{entry.command}</code
      >
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel={copied === entry.id
          ? `${entry.label} command copied`
          : `Copy ${entry.label.toLowerCase()} command`}
        title={copied === entry.id ? "Copied" : "Copy command"}
        onclick={() => void copy(entry.id, entry.command)}
      >
        {#key copied === entry.id}
          <span class="inline-flex" transition:scale={{ duration: 120 }}>
            {#if copied === entry.id}
              <Check class="size-3.5 text-success" aria-hidden="true" />
            {:else}
              <Copy class="size-3.5" aria-hidden="true" />
            {/if}
          </span>
        {/key}
      </Button>
    </div>
  {/each}
</div>
