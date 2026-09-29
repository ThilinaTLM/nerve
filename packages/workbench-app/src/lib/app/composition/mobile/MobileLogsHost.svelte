<script lang="ts">
import { onDestroy, untrack } from "svelte";
import Copy from "@lucide/svelte/icons/copy";
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { ApplicationLogRecord } from "@nervekit/contracts/logs";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Sheet from "@nervekit/ui-kit/components/ui/sheet";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import {
  MobileActionSheet,
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import { formatApplicationLog } from "$lib/presentation/logs/log-entry";
import { notify } from "$lib/application/notifications/notify.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import {
  getApplicationLogs,
  pruneApplicationLogs,
} from "$lib/features/logs/api/logs.api";
import { logRefreshState } from "$lib/features/logs/state/log-refresh.svelte";
import {
  LogsPaneController,
  type LogLevelFilter,
} from "$lib/features/logs/state/logs-pane-controller";
import { backFromMobileScreen } from "$lib/app/shell/mobile/mobile-shell.svelte";

/**
 * Application logs at phone scale: a level switch and a search box instead of
 * the desktop filter bar, compact rows, and a sheet with the full record.
 */
const FILTER_DEBOUNCE_MS = 250;

let revision = $state(0);
let filterTimer: ReturnType<typeof setTimeout> | undefined;
const controller = new LogsPaneController(
  {
    getLogs: getApplicationLogs,
    pruneLogs: pruneApplicationLogs,
    writeText: writeClipboardText,
  },
  () => (revision += 1),
);

const model = $derived.by(() => {
  void revision;
  return {
    rows: controller.rows,
    level: controller.level,
    contains: controller.contains,
    hasMoreBefore: controller.hasMoreBefore,
    loading: controller.loading,
    loadingEarlier: controller.loadingEarlier,
    pruning: controller.pruning,
    error: controller.error,
    pruneDescription: controller.pruneDescription,
  };
});
// Newest first reads naturally on a phone; "load earlier" sits at the end.
const rows = $derived(model.rows.toReversed());

let query = $state("");
let selected = $state<ApplicationLogRecord>();
let menuOpen = $state(false);
let pruneOpen = $state(false);

function cancelScheduledRefresh(): void {
  if (filterTimer !== undefined) clearTimeout(filterTimer);
  filterTimer = undefined;
}

function refreshNow(): void {
  cancelScheduledRefresh();
  void controller.refresh();
}

onDestroy(cancelScheduledRefresh);

$effect(() => {
  void logRefreshState.request;
  untrack(refreshNow);
});

function setLevel(value: string) {
  if (!value) return;
  controller.setLevel(value as LogLevelFilter);
  refreshNow();
}

function setQuery(value: string) {
  query = value;
  controller.setContains(value);
  cancelScheduledRefresh();
  filterTimer = setTimeout(() => {
    filterTimer = undefined;
    void controller.refresh();
  }, FILTER_DEBOUNCE_MS);
}

function tone(log: ApplicationLogRecord): StatusTone {
  if (log.level === "error") return "destructive";
  if (log.level === "warn") return "warning";
  if (log.level === "debug") return "neutral";
  return "info";
}

function time(log: ApplicationLogRecord): string {
  return new Date(log.ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function copy(text: string) {
  try {
    await writeClipboardText(text);
    notify.success("Copied");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}

const menuItems = $derived<ContextMenuItem[]>([
  {
    label: "Copy visible logs",
    icon: Copy,
    disabled: model.rows.length === 0,
    onSelect: () => void controller.copy(),
  },
  {
    label: "Prune logs",
    icon: Trash2,
    destructive: true,
    disabled: model.pruning,
    onSelect: () => (pruneOpen = true),
  },
]);
</script>

<MobileScreen
  title="Logs"
  subtitle={model.loading ? "Loading…" : `${model.rows.length} entries`}
  onBack={backFromMobileScreen}
  backLabel="Back"
>
  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Refresh logs"
      disabled={model.loading}
      onclick={refreshNow}
    >
      <RefreshCw size={17} strokeWidth={1.9} />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Log actions"
      onclick={() => (menuOpen = true)}
    >
      <EllipsisVertical size={18} strokeWidth={1.9} />
    </Button>
  {/snippet}

  <div class="grid gap-2 px-3 pt-2">
    <ToggleGroup.Root
      type="single"
      size="sm"
      variant="outline"
      class="w-full"
      value={model.level}
      aria-label="Log level"
      onValueChange={setLevel}
    >
      <ToggleGroup.Item value="all" class="flex-1">All</ToggleGroup.Item>
      <ToggleGroup.Item value="warn" class="flex-1">Warn</ToggleGroup.Item>
      <ToggleGroup.Item value="error" class="flex-1">Error</ToggleGroup.Item>
    </ToggleGroup.Root>
    <SearchInput
      value={query}
      onValueChange={setQuery}
      placeholder="Search messages"
      ariaLabel="Search logs"
    />
  </div>

  {#if model.error}
    <p class="px-6 py-4 text-sm text-destructive">{model.error}</p>
  {/if}

  {#if rows.length}
    <MobileSection>
      {#each rows as log (log.id)}
        <MobileListRow
          title={log.message}
          meta={time(log)}
          detail={`${log.source}/${log.component}`}
          tone={tone(log)}
          chevron={false}
          onclick={() => (selected = log)}
        />
      {/each}
    </MobileSection>
    {#if model.hasMoreBefore}
      <div class="flex justify-center px-3 py-2">
        <Button
          variant="outline"
          size="sm"
          disabled={model.loadingEarlier}
          onclick={() => void controller.loadEarlier()}
        >
          {model.loadingEarlier ? "Loading…" : "Load earlier"}
        </Button>
      </div>
    {/if}
  {:else if !model.loading}
    <p class="px-6 py-10 text-center text-sm text-muted-foreground">
      No log entries match.
    </p>
  {/if}
</MobileScreen>

<MobileActionSheet
  open={menuOpen}
  title="Logs"
  items={menuItems}
  onOpenChange={(open) => (menuOpen = open)}
/>

<Sheet.Root
  open={Boolean(selected)}
  onOpenChange={(open) => {
    if (!open) selected = undefined;
  }}
>
  <Sheet.Content
    side="bottom"
    class="max-h-[80dvh] rounded-t-lg pb-[env(safe-area-inset-bottom)]"
    swipeToDismiss
    onSwipeDismiss={() => (selected = undefined)}
  >
    {#if selected}
      {@const text = formatApplicationLog(selected)}
      <Sheet.Title class="px-4 pt-3 text-sm font-semibold">
        {selected.level.toUpperCase()} · {selected.source}/{selected.component}
      </Sheet.Title>
      <pre
        class="mx-3 min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-md bg-well p-3 font-mono text-xs">{text}</pre>
      <div class="flex justify-end px-3 pb-3">
        <Button variant="outline" size="sm" onclick={() => void copy(text)}>
          <Copy />
          Copy
        </Button>
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>

<ConfirmDialog
  bind:open={pruneOpen}
  title="Prune logs?"
  description={model.pruneDescription}
  confirmLabel="Prune"
  destructive
  onConfirm={async () => {
    const pruned = await controller.prune();
    if (pruned && controller.notice) notify.success(controller.notice);
  }}
/>
