<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { StorageCleanupTarget, StorageUsageResponse } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import DialogShell from "@nervekit/ui-kit/components/ui/dialog-shell";
import { SettingsInlineMessage } from "$lib/presentation/components/settings";
import {
  allCleanupSelection,
  buildCleanupRequest,
  cleanupSelectionError,
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
  usage?: StorageUsageResponse;
  onStart: (
    request: NonNullable<ReturnType<typeof buildCleanupRequest>>,
  ) => void;
};

let { open = $bindable(false), usage, onStart }: Props = $props();

let selection = $state<StorageCleanupSelection>({ ...EMPTY_CLEANUP_SELECTION });
let confirmOpen = $state(false);
let openGroups = $state<Record<string, boolean>>({
  history: true,
  logs: false,
  disposable: false,
  index: false,
});

const request = $derived(buildCleanupRequest(selection));
const selectionError = $derived(cleanupSelectionError(selection));
const targets = $derived(selectedTargets(selection));
const footprint = $derived(
  selectedFootprint(selection, usage?.cleanupTargets ?? []),
);

const groupTargets: Record<string, StorageCleanupTarget[]> = {
  history: ["conversations"],
  logs: ["datedLogs", "rotatedEventLog"],
  disposable: ["exploreReports", "crashReports", "cache", "tmp"],
  index: ["searchIndex"],
};

function groupCount(group: string): number {
  const selected = new Set(targets);
  return groupTargets[group].filter((target) => selected.has(target)).length;
}

function targetFootprint(target: StorageCleanupTarget): string {
  const item = usage?.cleanupTargets.find(
    (candidate) => candidate.target === target,
  );
  if (!item) return "Not calculated";
  const prefix = item.estimate === "exact" ? "" : "Up to ";
  return `${prefix}${formatBytes(item.bytes)}`;
}

function resetSelection(
  next: StorageCleanupSelection = { ...EMPTY_CLEANUP_SELECTION },
): void {
  selection = { ...next };
}

function start(): void {
  if (!request) return;
  onStart(request);
  open = false;
}
</script>

{#snippet groupHeader(group: string, title: string, description: string)}
  <Collapsible.Trigger
    class="group/cleanup flex w-full items-center gap-2 rounded-md px-1 py-1.5"
  >
    <ChevronRight
      class="size-3.5 flex-none text-muted-foreground transition-transform group-data-[state=open]/cleanup:rotate-90"
      aria-hidden="true"
    />
    <span class="grid min-w-0 flex-1 gap-0.5 text-left">
      <span class="text-sm font-medium text-foreground">{title}</span>
      <span class="text-xs text-muted-foreground">{description}</span>
    </span>
    {#if groupCount(group) > 0}
      <span class="text-xs text-muted-foreground">{groupCount(group)}</span>
    {/if}
  </Collapsible.Trigger>
{/snippet}

<DialogShell
  bind:open
  title="Clean up storage"
  description="Choose what to remove. Current footprints are estimates; final results use measured space."
  size="md"
>
  <div class="grid gap-3">
    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5"
    >
      <div class="grid gap-0.5">
        <span class="text-sm font-medium">
          {targets.length} target{targets.length === 1 ? "" : "s"} selected
        </span>
        <span class="text-xs text-muted-foreground">
          Will free ≈ {footprint.upTo ? "up to " : ""}{formatBytes(
            footprint.bytes,
          )}
        </span>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="outline"
          onclick={() => resetSelection(recommendedCleanupSelection())}
          >Recommended</Button
        >
        <Button
          size="xs"
          variant="outline"
          onclick={() => resetSelection(allCleanupSelection(selection))}
          >Select all</Button
        >
        <Button size="xs" variant="ghost" onclick={() => resetSelection()}
          >Clear</Button
        >
      </div>
    </div>

    <Collapsible.Root bind:open={openGroups.history}>
      {@render groupHeader(
        "history",
        "History",
        "Permanent conversation and message removal.",
      )}
      <Collapsible.Content
        class="mt-1 divide-y divide-border/60 rounded-md border border-border/60"
      >
        <StorageCleanupChoice
          id="cleanup-conversations"
          bind:checked={selection.conversations}
          bind:amount={selection.conversationsDays}
          amountLabel="Conversation age in days"
          amountSuffix="days"
          title="Old conversations"
          description={`Not updated recently · ${targetFootprint("conversations")}`}
        />
      </Collapsible.Content>
    </Collapsible.Root>

    <Collapsible.Root bind:open={openGroups.logs}>
      {@render groupHeader(
        "logs",
        "Logs",
        "Diagnostic history that is not required for conversations.",
      )}
      <Collapsible.Content
        class="mt-1 divide-y divide-border/60 rounded-md border border-border/60"
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
          description={`Remove the older retained event generation · ${targetFootprint("rotatedEventLog")}`}
        />
      </Collapsible.Content>
    </Collapsible.Root>

    <Collapsible.Root bind:open={openGroups.disposable}>
      {@render groupHeader(
        "disposable",
        "Disposable data",
        "Generated output that Nerve can operate without.",
      )}
      <Collapsible.Content
        class="mt-1 divide-y divide-border/60 rounded-md border border-border/60"
      >
        <StorageCleanupChoice
          id="cleanup-explore"
          bind:checked={selection.exploreReports}
          title="Explore reports"
          description={`Saved explore-agent output · ${targetFootprint("exploreReports")}`}
        />
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
          description={`Disposable cached data · ${targetFootprint("cache")}`}
        />
        <StorageCleanupChoice
          id="cleanup-tmp"
          bind:checked={selection.tmp}
          title="Temporary files"
          description={`Scratch files · ${targetFootprint("tmp")}`}
        />
      </Collapsible.Content>
    </Collapsible.Root>

    <Collapsible.Root bind:open={openGroups.index}>
      {@render groupHeader(
        "index",
        "Search index",
        "Rebuild the query cache instead of vacuuming the large database in place.",
      )}
      <Collapsible.Content class="mt-1 rounded-md border border-border/60">
        <StorageCleanupChoice
          id="cleanup-index"
          bind:checked={selection.searchIndex}
          title="Rebuild search index"
          description={`Recreate from current records and retained event logs · ${targetFootprint("searchIndex")}`}
        />
      </Collapsible.Content>
    </Collapsible.Root>

    {#if selection.searchIndex}
      <SettingsInlineMessage
        tone="warning"
        text="Older searchable event history that exists only in the index will be dropped. Conversation files are not removed by this option."
      />
    {/if}
    {#if selection.conversations}
      <SettingsInlineMessage
        tone="error"
        text="Old conversations and their messages are permanently deleted and cannot be recovered."
      />
    {/if}
    {#if selectionError}
      <SettingsInlineMessage tone="error" text={selectionError} />
    {/if}
  </div>

  {#snippet footer()}
    <span class="mr-auto text-xs text-muted-foreground">
      Will free ≈ {footprint.upTo ? "up to " : ""}{formatBytes(footprint.bytes)}
    </span>
    <Button size="sm" variant="outline" onclick={() => (open = false)}
      >Cancel</Button
    >
    <Button
      size="sm"
      variant="destructive"
      disabled={!request || !!selectionError}
      onclick={() => (confirmOpen = true)}
    >
      <Trash2 class="size-3.5" aria-hidden="true" /> Review cleanup
    </Button>
  {/snippet}
</DialogShell>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Start storage cleanup?"
  description={`This runs ${targets.length} selected cleanup target${targets.length === 1 ? "" : "s"}. Permanent history deletion cannot be undone.`}
  confirmLabel="Start cleanup"
  destructive={true}
  onConfirm={start}
/>
