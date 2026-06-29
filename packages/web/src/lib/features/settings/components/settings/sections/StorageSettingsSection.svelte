<script lang="ts">
  import { onMount } from "svelte";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { StorageCleanupRequest, StorageUsageResponse } from "$lib/api";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import { Input } from "$lib/components/ui/input";
  import { Progress } from "$lib/components/ui/progress";
  import {
    getStorageUsage,
    runStorageCleanup,
  } from "$lib/features/settings/api/storage.api";
  import { notify } from "$lib/features/notifications/notify.svelte";

  let usage = $state<StorageUsageResponse | undefined>();
  let loading = $state(true);
  let errorMessage = $state<string | undefined>();
  let running = $state(false);
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

  function percent(bytes: number): number {
    if (!totalBytes) return 0;
    return Math.min(100, Math.round((bytes / totalBytes) * 100));
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

<section id="settings-storage" class="settings-section" data-section="storage">
  <header class="settings-section-header">
    <h2>Storage</h2>
  </header>

  <div class="settings-section-body">
    <div class="storage-summary">
      <div class="storage-summary-total">
        <span>Total</span>
        <strong>{formatBytes(totalBytes)}</strong>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={loading}
        onclick={load}
        aria-label="Refresh storage usage"
      >
        <RefreshCw size={14} strokeWidth={2} /> Refresh
      </Button>
    </div>

    {#if errorMessage}
      <p class="settings-note settings-note-error">{errorMessage}</p>
    {:else if loading && !usage}
      <p class="settings-note">Calculating storage usage…</p>
    {:else if usage}
      <ul class="storage-breakdown">
        {#each usage.categories as category (category.key)}
          <li class="storage-row">
            <div class="storage-row-head">
              <span class="storage-row-label">
                {category.label}
                {#if category.protected}
                  <Badge size="sm" variant="secondary">Protected</Badge>
                {/if}
              </span>
              <span class="storage-row-size">{formatBytes(category.bytes)}</span>
            </div>
            <Progress value={percent(category.bytes)} max={100} />
            <span class="storage-row-meta">
              {category.fileCount.toLocaleString()} files · {percent(category.bytes)}%
            </span>
          </li>
        {/each}
      </ul>

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
        <div class="settings-row settings-row-stacked">
          <div class="settings-copy">
            <strong>Largest conversations</strong>
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

      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Free up space</strong>
          <span>Select what to remove.</span>
        </div>

        <div class="storage-cleanup">
          <label class="storage-cleanup-item">
            <Checkbox bind:checked={pruneConversations} aria-label="Prune old conversations" />
            <span class="storage-cleanup-text">
              <strong>Old conversations</strong>
              <span>Delete conversations not updated recently.</span>
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
              <span>Delete dated application and desktop logs.</span>
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
              <span>Compact superseded tool-call history.</span>
            </span>
          </label>

          <label class="storage-cleanup-item">
            <Checkbox bind:checked={truncateEventLog} aria-label="Remove rotated event log" />
            <span class="storage-cleanup-text">
              <strong>Rotated event log</strong>
              <span>Remove the archived events.jsonl.1 file.</span>
            </span>
          </label>

          <label class="storage-cleanup-item">
            <Checkbox bind:checked={clearExploreReports} aria-label="Clear explore reports" />
            <span class="storage-cleanup-text">
              <strong>Explore reports</strong>
              <span>Delete saved explore sub-agent output.</span>
            </span>
          </label>

          <label class="storage-cleanup-item">
            <Checkbox bind:checked={clearCache} aria-label="Clear cache" />
            <span class="storage-cleanup-text">
              <strong>Cache</strong>
              <span>Remove disposable cached data.</span>
            </span>
          </label>

          <label class="storage-cleanup-item">
            <Checkbox bind:checked={clearTmp} aria-label="Clear temporary files" />
            <span class="storage-cleanup-text">
              <strong>Temporary files</strong>
              <span>Remove scratch files in the tmp directory.</span>
            </span>
          </label>

          <label class="storage-cleanup-item">
            <Checkbox bind:checked={vacuumSqlite} aria-label="Compact search index" />
            <span class="storage-cleanup-text">
              <strong>Search index</strong>
              <span>Checkpoint and VACUUM the SQLite cache.</span>
            </span>
          </label>
        </div>

        <div>
          <Button
            size="sm"
            variant="destructive"
            disabled={!hasSelection || running}
            onclick={() => (confirmOpen = true)}
          >
            <Trash2 size={14} strokeWidth={2} />
            {running ? "Freeing space…" : "Free up space"}
          </Button>
        </div>
      </div>

      <p class="settings-note">
        Deletions are permanent. The search index is rebuildable, but pruned
        conversations and logs cannot be recovered.
      </p>
    {/if}
  </div>
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Free up storage?"
  description={`This permanently removes: ${selectionSummary()}.`}
  confirmLabel="Delete data"
  onConfirm={runCleanup}
/>
