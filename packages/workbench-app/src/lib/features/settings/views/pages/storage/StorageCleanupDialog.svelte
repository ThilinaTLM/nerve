<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { StorageCleanupTarget, StorageUsageResponse } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import {
  allCleanupSelection,
  buildCleanupRequest,
  cleanupSelectionError,
  cleanupSelectionFor,
  EMPTY_CLEANUP_SELECTION,
  recommendedCleanupSelection,
  selectedFootprint,
  selectedTargets,
  type StorageCleanupSelection,
} from "$lib/features/settings/state/storage-cleanup";
import { formatBytes } from "./storage-format";
import StorageCleanupChoice from "./StorageCleanupChoice.svelte";

type Props = {
  open?: boolean;
  /** Opens with only this target selected; without it, the recommended set. */
  preset?: StorageCleanupTarget;
  usage?: StorageUsageResponse;
  onStart: (
    request: NonNullable<ReturnType<typeof buildCleanupRequest>>,
  ) => void;
};

let { open = $bindable(false), preset, usage, onStart }: Props = $props();

const groupTargets: Record<string, StorageCleanupTarget[]> = {
  history: ["conversations"],
  logs: ["datedLogs", "rotatedEventLog"],
  disposable: ["crashReports", "cache", "tmp"],
};

let selection = $state<StorageCleanupSelection>(recommendedCleanupSelection());
let confirmOpen = $state(false);
let openGroups = $state<Record<string, boolean>>({
  history: false,
  logs: true,
  disposable: true,
});

// Each opening starts from what the user asked for: one category's cleanup
// from its row, or the recommended set from the header.
let wasOpen = false;
$effect.pre(() => {
  if (open && !wasOpen) {
    selection = preset
      ? cleanupSelectionFor(preset)
      : recommendedCleanupSelection();
    const selected = new Set(selectedTargets(selection));
    openGroups = Object.fromEntries(
      Object.entries(groupTargets).map(([group, targets]) => [
        group,
        targets.some((target) => selected.has(target)),
      ]),
    );
  }
  wasOpen = open;
});

const request = $derived(buildCleanupRequest(selection));
const selectionError = $derived(cleanupSelectionError(selection));
const targets = $derived(selectedTargets(selection));
const footprint = $derived(
  selectedFootprint(selection, usage?.cleanupTargets ?? []),
);

function groupCount(group: string): number {
  const selected = new Set(targets);
  return groupTargets[group].filter((target) => selected.has(target)).length;
}

function targetFootprint(target: StorageCleanupTarget): string {
  const item = usage?.cleanupTargets.find(
    (candidate) => candidate.target === target,
  );
  if (!item) return "Not measured";
  const prefix = item.estimate === "exact" ? "" : "Up to ";
  return `${prefix}${formatBytes(item.bytes)}`;
}

function resetSelection(
  next: StorageCleanupSelection = { ...EMPTY_CLEANUP_SELECTION },
): void {
  selection = { ...next };
}

/** Only deleting history is irreversible enough to ask twice. */
function review(): void {
  if (selection.conversations) confirmOpen = true;
  else start();
}

function start(): void {
  if (!request) return;
  onStart(request);
  open = false;
}
</script>

{#snippet groupHeader(group: string, title: string, description: string)}
  <Collapsible.Trigger
    class="group/cleanup flex w-full items-center gap-1.5 rounded-sm px-0.5 py-1"
  >
    <ChevronRight
      class="size-3.5 flex-none text-muted-foreground transition-transform group-data-[state=open]/cleanup:rotate-90"
      aria-hidden="true"
    />
    <span class="grid min-w-0 flex-1 gap-0.5 text-left">
      <span class="text-ui text-foreground">{title}</span>
      <span class="text-caption text-muted-foreground">{description}</span>
    </span>
    {#if groupCount(group) > 0}
      <span class="text-caption text-muted-foreground"
        >{groupCount(group)} selected</span
      >
    {/if}
  </Collapsible.Trigger>
{/snippet}

<DialogShell
  bind:open
  title="Clean up storage"
  description="Choose what to remove."
  size="md"
>
  <div class="grid gap-2">
    <div class="flex flex-wrap gap-1.5">
      <Button
        size="sm"
        variant="outline"
        onclick={() => resetSelection(recommendedCleanupSelection())}
        >Recommended</Button
      >
      <Button
        size="sm"
        variant="outline"
        onclick={() => resetSelection(allCleanupSelection(selection))}
        >Select all</Button
      >
      <Button size="sm" variant="ghost" onclick={() => resetSelection()}
        >Clear</Button
      >
    </div>

    <Collapsible.Root bind:open={openGroups.logs}>
      {@render groupHeader(
        "logs",
        "Logs",
        "Diagnostic history that conversations do not need.",
      )}
      <Collapsible.Content
        class="mt-0.5 divide-y divide-border-subtle rounded-md border border-border-subtle"
      >
        <StorageCleanupChoice
          id="cleanup-dated-logs"
          bind:checked={selection.datedLogs}
          bind:amount={selection.logsDays}
          amountLabel="Log age in days"
          amountSuffix="days"
          title="Dated log files"
          description={`Application and desktop logs · ${targetFootprint("datedLogs")}`}
        />
        <StorageCleanupChoice
          id="cleanup-event-log"
          bind:checked={selection.rotatedEventLog}
          title="Rotated event log"
          description={`The older retained event generation · ${targetFootprint("rotatedEventLog")}`}
        />
      </Collapsible.Content>
    </Collapsible.Root>

    <Collapsible.Root bind:open={openGroups.disposable}>
      {@render groupHeader(
        "disposable",
        "Disposable data",
        "Generated output Nerve can work without.",
      )}
      <Collapsible.Content
        class="mt-0.5 divide-y divide-border-subtle rounded-md border border-border-subtle"
      >
        <StorageCleanupChoice
          id="cleanup-crash-reports"
          bind:checked={selection.crashReports}
          title="Crash and Node reports"
          description={`Diagnostic reports · ${targetFootprint("crashReports")}`}
        />
        <StorageCleanupChoice
          id="cleanup-cache"
          bind:checked={selection.cache}
          title="Cache"
          description={`Cached data · ${targetFootprint("cache")}`}
        />
        <StorageCleanupChoice
          id="cleanup-tmp"
          bind:checked={selection.tmp}
          title="Temporary files"
          description={`Scratch files · ${targetFootprint("tmp")}`}
        />
      </Collapsible.Content>
    </Collapsible.Root>

    <Collapsible.Root bind:open={openGroups.history}>
      {@render groupHeader(
        "history",
        "History",
        "Conversations and their messages, permanently.",
      )}
      <Collapsible.Content
        class="mt-0.5 divide-y divide-border-subtle rounded-md border border-border-subtle"
      >
        <StorageCleanupChoice
          id="cleanup-conversations"
          bind:checked={selection.conversations}
          bind:amount={selection.conversationsDays}
          amountLabel="Conversation age in days"
          amountSuffix="days"
          title="Old conversations"
          description={`Not updated in this many days · ${targetFootprint("conversations")}`}
        />
      </Collapsible.Content>
    </Collapsible.Root>

    {#if selectionError}
      <Callout tone="destructive" text={selectionError} />
    {:else if selection.conversations}
      <Callout
        tone="warning"
        text="Deleted conversations cannot be recovered."
      />
    {/if}
  </div>

  {#snippet footer()}
    <span class="mr-auto text-ui text-muted-foreground">
      {targets.length === 0
        ? "Nothing selected"
        : `Frees ${footprint.upTo ? "up to " : ""}${formatBytes(footprint.bytes)}`}
    </span>
    <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
    <Button
      variant="destructive"
      disabled={!request || !!selectionError}
      onclick={review}
    >
      <Trash2 class="size-3.5" aria-hidden="true" /> Clean up
    </Button>
  {/snippet}
</DialogShell>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Delete old conversations?"
  description={`Conversations not updated in ${selection.conversationsDays} days are deleted with their messages, along with the other selected items. This cannot be undone.`}
  confirmLabel="Delete and clean up"
  destructive={true}
  onConfirm={start}
/>
