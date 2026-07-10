<script lang="ts">
  import { onMount } from "svelte";
  import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Database from "@lucide/svelte/icons/database";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type {
    StorageCategoryUsage,
    StorageCleanupOperation,
    StorageCleanupTarget,
    StorageUsageResponse,
  } from "$lib/api";
  import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import { Checkbox } from "@nervekit/workbench-ui/components/ui/checkbox";
  import ConfirmDialog from "@nervekit/workbench-ui/components/ui/confirm-dialog";
  import DialogShell from "@nervekit/workbench-ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/workbench-ui/components/ui/input";
  import { Progress } from "@nervekit/workbench-ui/components/ui/progress";
  import { SettingsSectionCard } from "@nervekit/workbench-ui/components/settings";
  import { onEvent } from "$lib/core/events/event-bus";
  import { notify } from "$lib/features/notifications/notify.svelte";
  import {
    cancelStorageCleanup,
    getStorageCleanup,
    getStorageUsage,
    startStorageCleanup,
  } from "$lib/features/settings/api/storage.api";
  import CleanupChoice from "./StorageCleanupChoice.svelte";
  import {
    allCleanupSelection,
    buildCleanupRequest,
    cleanupProgress,
    cleanupSelectionError,
    EMPTY_CLEANUP_SELECTION,
    isCleanupActive,
    parseStorageCleanupEvent,
    recommendedCleanupSelection,
    selectedFootprint,
    selectedTargets,
    targetLabel,
    type StorageCleanupSelection,
  } from "$lib/features/settings/state/storage-cleanup";

  let usage = $state<StorageUsageResponse>();
  let operation = $state<StorageCleanupOperation | null>(null);
  let loading = $state(true);
  let refreshing = $state(false);
  let operationLoading = $state(false);
  let errorMessage = $state<string>();
  let cleanupOpen = $state(false);
  let confirmOpen = $state(false);
  let selection = $state<StorageCleanupSelection>({ ...EMPTY_CLEANUP_SELECTION });
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let lastNotifiedOperationId: string | undefined;

  const storageTones = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--primary", "--info", "--warning"];

  const totalBytes = $derived(usage?.totalBytes ?? 0);
  const categories = $derived(
    [...(usage?.categories ?? [])].filter((category) => category.bytes > 0).sort((left, right) => right.bytes - left.bytes),
  );
  const active = $derived(isCleanupActive(operation));
  const request = $derived(buildCleanupRequest(selection));
  const selectionError = $derived(cleanupSelectionError(selection));
  const targets = $derived(selectedTargets(selection));
  const footprint = $derived(selectedFootprint(selection, usage?.cleanupTargets ?? []));
  const progressValue = $derived(operation ? cleanupProgress(operation) : 0);
  const completedWithIssues = $derived(operation?.results.some((result) => result.outcome === "failed") ?? false);

  function formatBytes(bytes: number): string {
    if (bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / 1024 ** exponent;
    return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  }

  function percent(bytes: number): number {
    return totalBytes > 0 ? Math.min(100, Math.round((bytes / totalBytes) * 100)) : 0;
  }

  function segmentStyle(bytes: number, index: number): string {
    return `width: ${Math.max(percent(bytes), 1)}%; background: var(${storageTones[index % storageTones.length]});`;
  }

  function targetFootprint(target: StorageCleanupTarget): string {
    const item = usage?.cleanupTargets.find((candidate) => candidate.target === target);
    if (!item) return "Not calculated";
    const prefix = item.estimate === "exact" ? "" : "Up to ";
    return `${prefix}${formatBytes(item.bytes)}`;
  }

  async function loadUsage(force = false) {
    if (force) refreshing = true;
    errorMessage = undefined;
    try {
      usage = await getStorageUsage();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Could not load storage usage.";
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  async function loadOperation() {
    operationLoading = true;
    try {
      const response = await getStorageCleanup();
      applyOperation(response.operation);
    } catch (error) {
      if (!usage) errorMessage = error instanceof Error ? error.message : "Could not load cleanup status.";
    } finally {
      operationLoading = false;
    }
  }

  function applyOperation(next: StorageCleanupOperation | null) {
    if (
      next &&
      operation?.id === next.id &&
      Date.parse(next.updatedAt) < Date.parse(operation.updatedAt)
    )
      return;
    operation = next;
    if (next?.usage) usage = next.usage;
    syncPolling();
    if (!next?.completedAt || lastNotifiedOperationId === next.id) return;
    lastNotifiedOperationId = next.id;
    if (next.status === "succeeded") {
      notify.success(next.results.some((result) => result.outcome === "failed") ? "Cleanup completed with issues" : `Freed ${formatBytes(next.freedBytes)}`);
    } else if (next.status === "failed") {
      notify.error("Cleanup failed", { description: next.error });
    }
  }

  function syncPolling() {
    if (isCleanupActive(operation) && !pollTimer) {
      pollTimer = setInterval(() => void loadOperation(), 2_500);
    } else if (!isCleanupActive(operation) && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  async function startCleanup() {
    if (!request) return;
    try {
      const response = await startStorageCleanup(request);
      applyOperation(response.operation);
      cleanupOpen = false;
    } catch (error) {
      notify.error("Could not start cleanup", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  }

  async function cancelCleanup() {
    if (!operation) return;
    try {
      const response = await cancelStorageCleanup(operation.id);
      applyOperation(response.operation);
    } catch (error) {
      notify.error("Could not cancel cleanup", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  }

  function resetSelection(next: StorageCleanupSelection = { ...EMPTY_CLEANUP_SELECTION }) {
    selection = { ...next };
  }

  function openCleanup() {
    if (active) return;
    cleanupOpen = true;
  }

  onMount(() => {
    void Promise.all([loadUsage(), loadOperation()]);
    const unsubscribe = onEvent("storage.cleanup.updated", (event) => {
      const next = parseStorageCleanupEvent(event.data);
      if (next) applyOperation(next);
    });
    return () => {
      unsubscribe();
      if (pollTimer) clearInterval(pollTimer);
    };
  });
</script>

<SettingsSectionCard
  section="storage"
  title="Storage"
  description="Understand what Nerve keeps locally and safely reclaim space."
  bodyClass="gap-4"
>
  {#snippet actions()}
    <Button size="sm" variant="outline" disabled={loading || refreshing || operation?.cancellable === false && active} onclick={() => void loadUsage(true)}>
      <RefreshCw class={refreshing ? "spin" : ""} size={14} strokeWidth={2} />
      {refreshing ? "Calculating…" : "Refresh"}
    </Button>
    <Button size="sm" disabled={!usage || active || operationLoading} onclick={openCleanup}>
      <Trash2 size={14} strokeWidth={2} />
      {active ? "Cleanup running" : "Clean up"}
    </Button>
  {/snippet}

  {#if errorMessage}
    <div class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <CircleAlert class="mt-0.5 size-4 shrink-0" />
      <span>{errorMessage}</span>
    </div>
  {/if}

  {#if loading && !usage}
    <div class="flex items-center gap-2 py-8 text-sm text-muted-foreground">
      <LoaderCircle class="spin size-4" /> Calculating local storage…
    </div>
  {:else if usage}
    <div class="grid gap-4">
      <section class="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div class="min-w-0">
          <p class="text-sm text-muted-foreground">Total local data</p>
          <p class="mt-1 text-3xl font-semibold tracking-tight">{formatBytes(totalBytes)}</p>
          <p class="mt-2 truncate font-mono text-xs text-muted-foreground" title={usage.dataDir}>{usage.dataDir}</p>
        </div>
        <div class="self-end text-left text-xs text-muted-foreground md:text-right">
          Calculated {new Date(usage.generatedAt).toLocaleString()}
        </div>
        <div class="col-span-full flex h-3 overflow-hidden rounded-full bg-muted" aria-label={`Storage usage total ${formatBytes(totalBytes)}`}>
          {#each categories as category, index (category.key)}
            <span style={segmentStyle(category.bytes, index)} title={`${category.label}: ${formatBytes(category.bytes)}`}></span>
          {/each}
        </div>
      </section>

      {#if operation && (active || operation.completedAt)}
        <section class="grid gap-3 rounded-lg border bg-card p-4" aria-live="polite">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-3">
              {#if active}
                <LoaderCircle class="spin mt-0.5 size-5 shrink-0 text-primary" />
              {:else if operation.status === "succeeded" && !completedWithIssues}
                <CheckCircle2 class="mt-0.5 size-5 shrink-0 text-success" />
              {:else}
                <CircleAlert class="mt-0.5 size-5 shrink-0 text-warning" />
              {/if}
              <div class="min-w-0">
                <p class="font-medium">
                  {active ? "Cleanup in progress" : operation.status === "cancelled" ? "Cleanup cancelled" : completedWithIssues ? "Cleanup completed with issues" : operation.status === "failed" ? "Cleanup failed" : "Cleanup complete"}
                </p>
                <p class="mt-0.5 text-sm text-muted-foreground">{operation.message}</p>
              </div>
            </div>
            {#if active && operation.cancellable}
              <Button size="sm" variant="outline" onclick={() => void cancelCleanup()}>
                Cancel cleanup
              </Button>
            {:else if !active}
              <Button size="sm" variant="outline" onclick={() => { resetSelection(); cleanupOpen = true; }}>
                <RotateCcw size={14} /> Clean more
              </Button>
            {/if}
          </div>

          {#if active}
            <Progress value={progressValue} aria-label="Cleanup progress" />
            <p class="text-xs text-muted-foreground">
              {operation.completedTargets} of {operation.totalTargets} targets complete
              {#if operation.status === "cancelling"} · stopping after the current target{/if}
              {#if !operation.cancellable} · this index step cannot be interrupted safely{/if}
            </p>
          {:else}
            <div class="flex flex-wrap items-baseline gap-x-2">
              <strong class="text-2xl">{formatBytes(operation.freedBytes)}</strong>
              <span class="text-sm text-muted-foreground">freed</span>
            </div>
          {/if}

          {#if !active && operation.results.length > 0}
            <ul class="divide-y rounded-md border">
              {#each operation.results as result (result.target)}
                <li class="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium">{targetLabel(result.target)}</span>
                      <Badge size="sm" tone={result.outcome === "succeeded" ? "good" : result.outcome === "failed" ? "danger" : "neutral"}>{result.outcome}</Badge>
                    </div>
                    {#if result.note || result.error}
                      <p class="mt-1 text-xs text-muted-foreground">{result.error ?? result.note}</p>
                    {/if}
                  </div>
                  <div class="font-mono text-xs text-muted-foreground sm:text-right">
                    {formatBytes(result.freedBytes)}
                    {#if result.removedItems > 0} · {result.removedItems} removed{/if}
                    {#if result.skipped > 0} · {result.skipped} skipped{/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      <div class="grid gap-3">
        <section class="overflow-hidden rounded-lg border bg-card">
          <div class="border-b px-4 py-3">
            <h3 class="text-sm font-medium">What uses space</h3>
            <p class="mt-0.5 text-xs text-muted-foreground">Categories are ordered by current footprint.</p>
          </div>
          <ul class="divide-y">
            {#each categories as category, index (category.key)}
              <li class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                <span class="size-2 rounded-full" style={`background: var(${storageTones[index % storageTones.length]});`}></span>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-medium">{category.label}</span>
                    {#if category.protected}<Badge size="sm" variant="secondary">Protected</Badge>{/if}
                    {#if category.cleanable}<Badge size="sm" variant="outline">Cleanable</Badge>{/if}
                  </div>
                  <p class="mt-0.5 truncate text-xs text-muted-foreground" title={category.description}>{category.fileCount.toLocaleString()} files · {percent(category.bytes)}%</p>
                </div>
                <span class="font-mono text-xs font-medium">{formatBytes(category.bytes)}</span>
              </li>
            {/each}
          </ul>
        </section>

        <div class="grid content-start gap-3">
          <section class="rounded-lg border bg-card p-4">
            <div class="flex items-center gap-2">
              <Database class="size-4 text-primary" />
              <h3 class="text-sm font-medium">Search index</h3>
              <Badge size="sm" variant="outline">Rebuildable</Badge>
            </div>
            <p class="mt-2 text-2xl font-semibold">{formatBytes(usage.sqlite.dbBytes + usage.sqlite.walBytes + usage.sqlite.shmBytes)}</p>
            <p class="mt-1 text-xs text-muted-foreground">Current records and retained event logs can be rebuilt into a fresh compact index.</p>
          </section>

          <section class="rounded-lg border bg-card p-4">
            <h3 class="text-sm font-medium">Conversations</h3>
            <p class="mt-1 text-2xl font-semibold">{usage.conversations.total.toLocaleString()}</p>
            {#if usage.conversations.largest.length > 0}
              <ul class="mt-3 grid gap-2 border-t pt-3">
                {#each usage.conversations.largest.slice(0, 3) as conversation (conversation.conversationId)}
                  <li class="flex min-w-0 justify-between gap-3 text-xs">
                    <span class="truncate" title={conversation.title ?? conversation.conversationId}>{conversation.title ?? conversation.conversationId}</span>
                    <span class="shrink-0 font-mono text-muted-foreground">{formatBytes(conversation.bytes)}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        </div>
      </div>
    </div>
  {/if}
</SettingsSectionCard>

<DialogShell bind:open={cleanupOpen} title="Clean up storage" description="Choose what to remove. Current footprints are estimates; final results use measured space." size="wide">
  <div class="grid gap-5 p-4">
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
      <div>
        <p class="text-sm font-medium">{targets.length} target{targets.length === 1 ? "" : "s"} selected</p>
        <p class="text-xs text-muted-foreground">{footprint.upTo ? "Up to " : ""}{formatBytes(footprint.bytes)} current footprint</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onclick={() => resetSelection(recommendedCleanupSelection())}>Recommended</Button>
        <Button size="sm" variant="outline" onclick={() => resetSelection(allCleanupSelection(selection))}>Select all</Button>
        <Button size="sm" variant="ghost" onclick={() => resetSelection()}>Clear</Button>
      </div>
    </div>

    <section class="grid gap-2">
      <div><h3 class="text-sm font-medium">History</h3><p class="text-xs text-muted-foreground">Permanent conversation and message removal.</p></div>
      <div class="grid gap-3 rounded-md border p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
        <Checkbox id="cleanup-conversations" bind:checked={selection.conversations} aria-label="Remove old conversations" />
        <label for="cleanup-conversations" class="cursor-pointer"><span class="block text-sm font-medium">Old conversations</span><span class="block text-xs text-muted-foreground">Not updated recently · {targetFootprint("conversations")}</span></label>
        <div class="flex items-center gap-2 pl-7 sm:pl-0"><Input type="number" size="sm" min={1} max={3650} value={selection.conversationsDays} disabled={!selection.conversations} ariaLabel="Conversation age in days" class="w-20" oninput={(event) => selection.conversationsDays = Number((event.currentTarget as HTMLInputElement).value)} /><span class="text-xs text-muted-foreground">days</span></div>
      </div>
    </section>

    <section class="grid gap-2">
      <div><h3 class="text-sm font-medium">Logs</h3><p class="text-xs text-muted-foreground">Diagnostic history that is not required for conversations.</p></div>
      <div class="divide-y rounded-md border">
        <div class="grid gap-3 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
          <Checkbox id="cleanup-dated-logs" bind:checked={selection.datedLogs} aria-label="Remove old dated logs" />
          <label for="cleanup-dated-logs" class="cursor-pointer"><span class="block text-sm font-medium">Dated log files</span><span class="block text-xs text-muted-foreground">Application and desktop logs · {targetFootprint("datedLogs")}</span></label>
          <div class="flex items-center gap-2 pl-7 sm:pl-0"><Input type="number" size="sm" min={1} max={3650} value={selection.logsDays} disabled={!selection.datedLogs} ariaLabel="Log age in days" class="w-20" oninput={(event) => selection.logsDays = Number((event.currentTarget as HTMLInputElement).value)} /><span class="text-xs text-muted-foreground">days</span></div>
        </div>
        <CleanupChoice id="cleanup-tool-log" bind:checked={selection.toolCallLog} title="Tool-call log" description={`Compact superseded tool-call rows · ${targetFootprint("toolCallLog")}`} />
        <CleanupChoice id="cleanup-event-log" bind:checked={selection.rotatedEventLog} title="Rotated event log" description={`Remove the older retained event generation · ${targetFootprint("rotatedEventLog")}`} />
      </div>
    </section>

    <section class="grid gap-2">
      <div><h3 class="text-sm font-medium">Disposable data</h3><p class="text-xs text-muted-foreground">Generated output that Nerve can operate without.</p></div>
      <div class="divide-y rounded-md border">
        <CleanupChoice id="cleanup-explore" bind:checked={selection.exploreReports} title="Explore reports" description={`Saved explore-agent output · ${targetFootprint("exploreReports")}`} />
        <CleanupChoice id="cleanup-cache" bind:checked={selection.cache} title="Cache" description={`Disposable cached data · ${targetFootprint("cache")}`} />
        <CleanupChoice id="cleanup-tmp" bind:checked={selection.tmp} title="Temporary files" description={`Scratch files · ${targetFootprint("tmp")}`} />
      </div>
    </section>

    <section class="grid gap-2">
      <div><h3 class="text-sm font-medium">Search index</h3><p class="text-xs text-muted-foreground">Rebuild the query cache instead of vacuuming the large database in place.</p></div>
      <div class="rounded-md border">
        <CleanupChoice id="cleanup-index" bind:checked={selection.searchIndex} title="Rebuild search index" description={`Recreate from current records and retained event logs · ${targetFootprint("searchIndex")}`} />
      </div>
      {#if selection.searchIndex}<p class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">Older searchable event history that exists only in the index will be dropped. Conversation files are not removed by this option.</p>{/if}
    </section>

    {#if selection.conversations}<p class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">Old conversations and their messages are permanently deleted and cannot be recovered.</p>{/if}
    {#if selectionError}<p class="text-sm text-destructive">{selectionError}</p>{/if}
  </div>

  {#snippet footer()}
    <Button size="sm" variant="outline" onclick={() => cleanupOpen = false}>Cancel</Button>
    <Button size="sm" variant="destructive" disabled={!request || !!selectionError} onclick={() => confirmOpen = true}>
      <Trash2 size={14} /> Review cleanup
    </Button>
  {/snippet}
</DialogShell>

<ConfirmDialog bind:open={confirmOpen} title="Start storage cleanup?" description={`This runs ${targets.length} selected cleanup target${targets.length === 1 ? "" : "s"}. Permanent history deletion cannot be undone.`} confirmLabel="Start cleanup" destructive={true} onConfirm={() => void startCleanup()} />
