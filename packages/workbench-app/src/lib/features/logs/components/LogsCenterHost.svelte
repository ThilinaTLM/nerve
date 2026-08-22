<script lang="ts">
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import {
  getApplicationLogs,
  pruneApplicationLogs,
} from "$lib/features/logs/api/logs.api";
import { logRefreshState } from "$lib/features/logs/state/log-refresh.svelte";
import { LogsPaneController } from "$lib/features/logs/state/logs-pane-controller";
import { LogsPane } from "$lib/presentation/logs";

let revision = $state(0);
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
    loading: controller.loading,
    pruning: controller.pruning,
    error: controller.error,
    notice: controller.notice,
    filtersActive: controller.filtersActive,
    pruneDescription: controller.pruneDescription,
  };
});

$effect(() => {
  void logRefreshState.request;
  void controller.refresh();
});
</script>

<LogsPane
  {model}
  actions={{
    onLevelChange: (value) => controller.setLevel(value),
    onSourceChange: (value) => controller.setSource(value),
    onComponentChange: (value) => controller.setComponent(value),
    onContainsChange: (value) => controller.setContains(value),
    onClearFilters: () => controller.clearFilters(),
    onRefresh: () => controller.refresh(),
    onCopy: () => controller.copy(),
    onPrune: () => controller.prune(),
  }}
/>
