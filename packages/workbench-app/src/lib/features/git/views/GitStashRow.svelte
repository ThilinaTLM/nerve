<script lang="ts">
import Archive from "@lucide/svelte/icons/archive";
import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { GitStashEntry } from "@nervekit/contracts/git";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { parseStashMessage } from "./git-stash-message";
import type { StashMutation } from "./git-panel-types";

type Props = {
  stash: GitStashEntry;
  busy: boolean;
  mutation?: StashMutation;
  confirmingDrop?: boolean;
  onApply: (stash: GitStashEntry) => void;
  onRequestDrop: (stash: GitStashEntry) => void;
  onCancelDrop: () => void;
  onConfirmDrop: (stash: GitStashEntry) => void;
};

let {
  stash,
  busy,
  mutation,
  confirmingDrop = false,
  onApply,
  onRequestDrop,
  onCancelDrop,
  onConfirmDrop,
}: Props = $props();

const parsed = $derived(parseStashMessage(stash.message));
const applying = $derived(
  mutation?.action === "apply" && mutation.hash === stash.hash,
);
const dropping = $derived(
  mutation?.action === "drop" && mutation.hash === stash.hash,
);
</script>

{#if confirmingDrop}
  <div
    role="listitem"
    class="flex items-center gap-2 rounded-md bg-destructive-subtle px-2 py-2"
  >
    <Trash2 class="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
    <span class="min-w-0 flex-1 text-ui">
      Drop <span class="font-mono">{stash.ref}</span>? This can’t be undone.
    </span>
    <Button variant="ghost" size="sm" disabled={busy} onclick={onCancelDrop}
      >Cancel</Button
    >
    <Button
      variant="destructive"
      size="sm"
      disabled={busy}
      onclick={() => onConfirmDrop(stash)}>Drop</Button
    >
  </div>
{:else}
  <div
    role="listitem"
    class="group/row flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover focus-within:bg-hover"
  >
    <Archive
      class="size-3.5 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
    <div class="grid min-w-0 flex-1 gap-0.5">
      <div class="flex min-w-0 items-center gap-2">
        <span class="truncate text-ui" title={stash.message}
          >{parsed.title}</span
        >
        {#if parsed.wip}<Badge>WIP</Badge>{/if}
      </div>
      <div
        class="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground"
      >
        {#if parsed.branch}
          <GitBranch class="size-3 shrink-0" aria-hidden="true" />
          <span class="truncate">{parsed.branch}</span>
          <span aria-hidden="true">·</span>
        {/if}
        <span class="font-mono">{stash.ref}</span>
        <span aria-hidden="true">·</span>
        <span class="shrink-0">{stash.relativeDate}</span>
      </div>
    </div>
    <div
      class="flex shrink-0 items-center gap-1 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-[active=true]:opacity-100"
      data-active={busy}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onclick={() => onApply(stash)}
      >
        {#if applying}
          <Spinner class="size-3" />
        {:else}
          <ArchiveRestore />
        {/if}
        Apply
      </Button>
      <IconAction
        icon={Trash2}
        label={`Drop ${stash.ref}`}
        tone="destructive"
        disabled={busy}
        busy={dropping}
        onclick={() => onRequestDrop(stash)}
      />
    </div>
  </div>
{/if}
