<script lang="ts">
import { onDestroy, untrack } from "svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import {
  getApplicationLogs,
  pruneApplicationLogs,
} from "$lib/features/logs/api/logs.api";
import { logRefreshState } from "$lib/features/logs/state/log-refresh.svelte";
import { LogsPaneController } from "$lib/features/logs/state/logs-pane-controller";
import { LogsPane } from "$lib/presentation/logs";

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
    source: controller.source,
    component: controller.component,
    contains: controller.contains,
    hasMoreBefore: controller.hasMoreBefore,
    loading: controller.loading,
    loadingEarlier: controller.loadingEarlier,
    pruning: controller.pruning,
    error: controller.error,
    historyError: controller.historyError,
    filtersActive: controller.filtersActive,
    pruneDescription: controller.pruneDescription,
  };
});

function cancelScheduledRefresh(): void {
  if (filterTimer !== undefined) clearTimeout(filterTimer);
  filterTimer = undefined;
}

function refreshNow(): void {
  cancelScheduledRefresh();
  void controller.refresh();
}

function scheduleFilterRefresh(): void {
  cancelScheduledRefresh();
  filterTimer = setTimeout(() => {
    filterTimer = undefined;
    void controller.refresh();
  }, 250);
}

onDestroy(cancelScheduledRefresh);

$effect(() => {
  void logRefreshState.request;
  untrack(refreshNow);
});
</script>

<LogsPane
  {model}
  actions={{
    onLevelChange: (value) => {
      controller.setLevel(value);
      refreshNow();
    },
    onSourceChange: (value) => {
      controller.setSource(value);
      refreshNow();
    },
    onComponentChange: (value) => {
      controller.setComponent(value);
      scheduleFilterRefresh();
    },
    onContainsChange: (value) => {
      controller.setContains(value);
      scheduleFilterRefresh();
    },
    onClearFilters: () => {
      controller.clearFilters();
      refreshNow();
    },
    onRefresh: refreshNow,
    onLoadEarlier: () => controller.loadEarlier(),
    onCopy: () => controller.copy(),
    onCopySelection: (text) => writeClipboardText(text),
    onPrune: async () => {
      const pruned = await controller.prune();
      if (pruned && controller.notice) notify.success(controller.notice);
      return pruned;
    },
  }}
/>
