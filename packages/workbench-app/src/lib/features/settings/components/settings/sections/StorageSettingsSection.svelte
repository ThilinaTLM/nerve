<script lang="ts">
  import { onMount } from "svelte";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type {
    StorageCategoryUsage,
    StorageCleanupRequest,
    StorageUsageResponse,
  } from "$lib/api";
  import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import { Checkbox } from "@nervekit/workbench-ui/components/ui/checkbox";
  import ConfirmDialog from "@nervekit/workbench-ui/components/ui/confirm-dialog";
  import DialogShell from "@nervekit/workbench-ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/workbench-ui/components/ui/input";
  import { notify } from "$lib/features/notifications/notify.svelte";
  import {
    getStorageUsage,
    runStorageCleanup,
  } from "$lib/features/settings/api/storage.api";
  import { SettingsSectionCard } from "@nervekit/workbench-ui/components/settings";

  type StorageCategoryKey = StorageCategoryUsage["key"];

  let usage = $state<StorageUsageResponse | undefined>();
  let loading = $state(true);
  let errorMessage = $state<string | undefined>();
  let running = $state(false);
  let cleanupOpen = $state(false);
  let confirmOpen = $state(false);

  // Cleanup form state.
  let pruneConversations = $state(false);
  let conversationsDays = $state(30);
  let pruneLogs = $state(false);
  let logsDays = $state(14);
  let truncateEventLog = $state(false);
  let clearToolCallLog = $state(false);
  let clearExploreReports = $state(false);
  let clearCache = $state(false);
  let clearTmp = $state(false);
  let vacuumSqlite = $state(false);

  const storageTones = [
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-5",
    "--primary",
    "--info",
    "--warning",
  ];

  function formatBytes(bytes: number): string {
    if (bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(
      units.length - 1,
      Math.floor(Math.log(bytes) / Math.log(1024)),
    );
    const value = bytes / 1024 ** exponent;
    const digits = value >= 100 || exponent === 0 ? 0 : 1;
    return `${value.toFixed(digits)} ${units[exponent]}`;
  }

  async function load() {
    loading = true;
    errorMessage = undefined;
    try {
      usage = await getStorageUsage();
    } catch (error) {
      errorMessage =
        error instanceof Error ? error.message : "Could not load storage usage.";
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const totalBytes = $derived(usage?.totalBytes ?? 0);
  const visibleCategories = $derived(
    (usage?.categories ?? [])
      .filter((category) => category.bytes > 0)
      .sort((left, right) => right.bytes - left.bytes),
  );
  const categoryByKey = $derived(
    new Map((usage?.categories ?? []).map((category) => [category.key, category])),
  );
  const generatedAtLabel = $derived(
    usage ? new Date(usage.generatedAt).toLocaleString() : "—",
  );

  function percent(bytes: number): number {
    if (!totalBytes) return 0;
    return Math.min(100, Math.round((bytes / totalBytes) * 100));
  }

  function segmentStyle(bytes: number, index: number): string {
    return `width: ${Math.max(percent(bytes), 1)}%; --storage-tone: var(${storageTones[index % storageTones.length]});`;
  }

  function categoryFootprint(keys: StorageCategoryKey[]): string {
    if (!usage) return "Not calculated";
    const categories = keys
      .map((key) => categoryByKey.get(key))
      .filter((category): category is StorageCategoryUsage => !!category);
    const bytes = categories.reduce((sum, category) => sum + category.bytes, 0);
    const files = categories.reduce((sum, category) => sum + category.fileCount, 0);
    return `${formatBytes(bytes)} · ${files.toLocaleString()} files`;
  }

  function buildRequest(): StorageCleanupRequest | undefined {
    const request: StorageCleanupRequest = {};
    if (pruneConversations && conversationsDays > 0)
      request.conversationsOlderThanDays = Math.floor(conversationsDays);
    if (pruneLogs && logsDays > 0)
      request.logsOlderThanDays = Math.floor(logsDays);
    if (truncateEventLog) request.truncateEventLog = true;
    if (clearToolCallLog) request.clearToolCallLog = true;
    if (clearExploreReports) request.clearExploreReports = true;
    if (clearCache) request.clearCache = true;
    if (clearTmp) request.clearTmp = true;
    if (vacuumSqlite) request.vacuumSqlite = true;
    return Object.keys(request).length > 0 ? request : undefined;
  }

  const cleanupRequest = $derived(buildRequest());
  const hasSelection = $derived(cleanupRequest !== undefined);

  function selectionSummary(): string {
    const parts: string[] = [];
    if (pruneConversations)
      parts.push(`conversations older than ${conversationsDays} days`);
    if (pruneLogs) parts.push(`logs older than ${logsDays} days`);
    if (truncateEventLog) parts.push("rotated event log");
    if (clearToolCallLog) parts.push("tool-call log");
    if (clearExploreReports) parts.push("explore reports");
    if (clearCache) parts.push("cache");
    if (clearTmp) parts.push("temporary files");
    if (vacuumSqlite) parts.push("compact the search index");
    return parts.join(", ");
  }

  async function runCleanup() {
    const request = cleanupRequest;
    if (!request) return;
    running = true;
    try {
      const response = await runStorageCleanup(request);
      usage = response.usage;
      notify.success(`Freed ${formatBytes(response.freedBytes)}`, {
        description: response.results
          .filter((result) => result.freedBytes > 0 || result.note)
          .map((result) => `${result.target}: ${formatBytes(result.freedBytes)}`)
          .join(" · "),
      });
      pruneConversations = false;
      pruneLogs = false;
      truncateEventLog = false;
      clearToolCallLog = false;
      clearExploreReports = false;
      clearCache = false;
      clearTmp = false;
      vacuumSqlite = false;
      cleanupOpen = false;
    } catch (error) {
      notify.error("Cleanup failed", {
        description:
          error instanceof Error ? error.message : "Could not free up space.",
      });
    } finally {
      running = false;
    }
  }
</script>

<SettingsSectionCard
  section="storage"
  title="Storage"
  description="Inspect local data usage and open cleanup when you need to free space."
>
  {#snippet actions()}
    <Button
      size="sm"
      variant="outline"
      disabled={loading}
      onclick={load}
      aria-label="Refresh storage usage"
    >
      <RefreshCw size={14} strokeWidth={2} /> Refresh
    </Button>
    <Button size="sm" disabled={!usage} onclick={() => (cleanupOpen = true)}>
      <Trash2 size={14} strokeWidth={2} /> Clean up
    </Button>
  {/snippet}
  {#if errorMessage}
    <p class="settings-note settings-note-error">{errorMessage}</p>
  {:else if loading && !usage}
    <p class="settings-note">Calculating storage usage…</p>
  {:else if usage}
    <div class="storage-overview">
      <div class="storage-summary-card">
        <span>Total local data</span>
        <strong>{formatBytes(totalBytes)}</strong>
        <p title={usage.dataDir}>{usage.dataDir}</p>
        <small>Calculated {generatedAtLabel}</small>
      </div>

      <div class="storage-meter-panel">
        <div class="storage-meter" aria-label={`Storage usage total ${formatBytes(totalBytes)}`}>
          {#if visibleCategories.length === 0}
            <span class="storage-meter-empty"></span>
          {:else}
            {#each visibleCategories as category, index (category.key)}
              <span
                class="storage-meter-segment"
                style={segmentStyle(category.bytes, index)}
                title={`${category.label}: ${formatBytes(category.bytes)} (${percent(category.bytes)}%)`}
              ></span>
            {/each}
          {/if}
        </div>

        <ul class="storage-category-grid" aria-label="Storage category breakdown">
          {#each visibleCategories as category, index (category.key)}
            <li style={`--storage-tone: var(${storageTones[index % storageTones.length]});`}>
              <span class="storage-category-dot"></span>
              <span class="storage-category-copy">
                <strong>{category.label}</strong>
                <span>{category.fileCount.toLocaleString()} files · {percent(category.bytes)}%</span>
              </span>
              <span class="storage-category-size">{formatBytes(category.bytes)}</span>
              {#if category.protected}
                <Badge size="sm" variant="secondary">Protected</Badge>
              {:else if category.cleanable}
                <Badge size="sm" variant="outline">Cleanable</Badge>
              {/if}
            </li>
          {/each}
        </ul>

        <div class="storage-insights">
          <div class="stat-grid storage-sqlite">
            <section>
              <span>SQLite database</span><strong>{formatBytes(usage.sqlite.dbBytes)}</strong>
            </section>
            <section>
              <span>Write-ahead log</span><strong>{formatBytes(usage.sqlite.walBytes)}</strong>
            </section>
            <section>
              <span>Conversations</span><strong>{usage.conversations.total.toLocaleString()}</strong>
            </section>
          </div>

          {#if usage.conversations.largest.length > 0}
            <div class="storage-largest-panel">
              <div class="settings-copy">
                <strong>Largest conversations</strong>
                <span>Conversation files with the largest local footprint.</span>
              </div>
              <ul class="storage-largest">
                {#each usage.conversations.largest as conversation (conversation.conversationId)}
                  <li>
                    <span title={conversation.conversationId}>
                      {conversation.title ?? conversation.conversationId}
                    </span>
                    <span class="storage-row-size">{formatBytes(conversation.bytes)}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}</SettingsSectionCard>

<DialogShell
  bind:open={cleanupOpen}
  title="Clean up storage"
  description="Select the local data you want to remove, then confirm before anything is deleted."
  class="storage-cleanup-dialog"
>
  <div class="storage-cleanup-dialog-body">
    <div class="settings-copy">
      <strong>Cleanup plan</strong>
      <span>
        {hasSelection ? selectionSummary() : "Select cleanup targets to build a cleanup plan."}
      </span>
    </div>

    <div class="storage-cleanup">
      <label class="storage-cleanup-item">
        <Checkbox bind:checked={pruneConversations} aria-label="Prune old conversations" />
        <span class="storage-cleanup-text">
          <strong>Old conversations</strong>
          <span>Not updated recently · {categoryFootprint(["conversations"])}</span>
        </span>
        <span class="storage-cleanup-control">
          <Input
            type="number"
            size="sm"
            min={1}
            value={conversationsDays}
            disabled={!pruneConversations}
            ariaLabel="Conversation age in days"
            oninput={(event) =>
              (conversationsDays = Number(
                (event.currentTarget as HTMLInputElement).value,
              ))}
          />
          <span>days</span>
        </span>
      </label>

      <label class="storage-cleanup-item">
        <Checkbox bind:checked={pruneLogs} aria-label="Prune old logs" />
        <span class="storage-cleanup-text">
          <strong>Old log files</strong>
          <span>Dated app and desktop logs · {categoryFootprint(["logs"])}</span>
        </span>
        <span class="storage-cleanup-control">
          <Input
            type="number"
            size="sm"
            min={1}
            value={logsDays}
            disabled={!pruneLogs}
            ariaLabel="Log age in days"
            oninput={(event) =>
              (logsDays = Number(
                (event.currentTarget as HTMLInputElement).value,
              ))}
          />
          <span>days</span>
        </span>
      </label>

      <label class="storage-cleanup-item">
        <Checkbox bind:checked={clearToolCallLog} aria-label="Compact tool-call log" />
        <span class="storage-cleanup-text">
          <strong>Tool-call log</strong>
          <span>Superseded tool-call history · {categoryFootprint(["logs"])}</span>
        </span>
      </label>

      <label class="storage-cleanup-item">
        <Checkbox bind:checked={truncateEventLog} aria-label="Remove rotated event log" />
        <span class="storage-cleanup-text">
          <strong>Rotated event log</strong>
          <span>Archived events.jsonl.1 · {categoryFootprint(["logs"])}</span>
        </span>
      </label>

      <label class="storage-cleanup-item">
        <Checkbox bind:checked={clearExploreReports} aria-label="Clear explore reports" />
        <span class="storage-cleanup-text">
          <strong>Explore reports</strong>
          <span>Saved explore output · {categoryFootprint(["exploreReports"])}</span>
        </span>
      </label>

      <label class="storage-cleanup-item">
        <Checkbox bind:checked={clearCache} aria-label="Clear cache" />
        <span class="storage-cleanup-text">
          <strong>Cache</strong>
          <span>Disposable cached data · {categoryFootprint(["cache"])}</span>
        </span>
      </label>

      <label class="storage-cleanup-item">
        <Checkbox bind:checked={clearTmp} aria-label="Clear temporary files" />
        <span class="storage-cleanup-text">
          <strong>Temporary files</strong>
          <span>Scratch tmp files · {categoryFootprint(["tmp"])}</span>
        </span>
      </label>

      <label class="storage-cleanup-item">
        <Checkbox bind:checked={vacuumSqlite} aria-label="Compact search index" />
        <span class="storage-cleanup-text">
          <strong>Search index</strong>
          <span>SQLite checkpoint + VACUUM · {categoryFootprint(["sqliteIndex"])}</span>
        </span>
      </label>
    </div>

    <p class="settings-note">
      Deletions are permanent. The search index is rebuildable, but pruned
      conversations and logs cannot be recovered.
    </p>
  </div>

  {#snippet footer()}
    <Button size="sm" variant="outline" onclick={() => (cleanupOpen = false)}>Cancel</Button>
    <Button
      size="sm"
      variant="destructive"
      disabled={!hasSelection || running}
      onclick={() => (confirmOpen = true)}
    >
      <Trash2 size={14} strokeWidth={2} />
      {running ? "Freeing space…" : "Free up space"}
    </Button>
  {/snippet}
</DialogShell>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Free up storage?"
  description={`This permanently removes: ${selectionSummary()}.`}
  confirmLabel="Delete data"
  onConfirm={runCleanup}
/>
