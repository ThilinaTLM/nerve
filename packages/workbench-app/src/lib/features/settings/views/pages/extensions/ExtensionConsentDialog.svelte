<!--
  The consent review of a pending installed extension: what it asks to do in
  plain language (for an update, only what is new), with Allow, Decline (while
  it waits for review) and Not now.
  Allowing is bound to the files the summary was made from; if they changed,
  the daemon refuses and the list shows the new summary.
-->
<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { ExtensionCatalogEntry } from "@nervekit/contracts/extensions";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";

type Props = {
  open: boolean;
  entry?: ExtensionCatalogEntry;
  busy?: boolean;
  onAllow: (entry: ExtensionCatalogEntry) => void;
  /** Declines it: it stays off and stops asking. */
  onDecline?: (entry: ExtensionCatalogEntry) => void;
};

let {
  open = $bindable(false),
  entry,
  busy = false,
  onAllow,
  onDecline,
}: Props = $props();

const consent = $derived(entry?.consent);
</script>

<DialogShell
  bind:open
  size="md"
  title={entry ? `Allow ${entry.name ?? entry.id}?` : "Allow extension"}
  description={consent?.update
    ? "This extension changed. It asks for the following new access."
    : "Review what this extension asks to do. It does not run until you allow it."}
>
  {#if entry && consent}
    <ul class="grid gap-2 text-ui">
      {#each consent.items as item (item.text)}
        <li class="flex items-start gap-2">
          {#if item.broad}
            <TriangleAlert
              class="mt-0.5 size-3.5 flex-none text-warning"
              aria-label="Broad access"
            />
          {:else}
            <span
              class="mt-1.5 size-1 flex-none rounded-full bg-muted-foreground"
              aria-hidden="true"
            ></span>
          {/if}
          <span class={item.broad ? "text-warning" : "text-foreground"}
            >{item.text}</span
          >
        </li>
      {/each}
    </ul>
    {#if entry.path}
      <p class="mt-3 break-all font-mono text-caption text-muted-foreground">
        {entry.path}
      </p>
    {/if}
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Not now</Button>
    {#if onDecline && entry && entry.trustState !== "declined"}
      <Button
        variant="outline"
        disabled={busy}
        onclick={() => {
          onDecline(entry);
          open = false;
        }}>Decline</Button
      >
    {/if}
    <Button
      disabled={busy || !entry}
      onclick={() => {
        if (!entry) return;
        onAllow(entry);
        open = false;
      }}>Allow</Button
    >
  {/snippet}
</DialogShell>
