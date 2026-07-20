<script lang="ts">
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import {
  TaskUtilityPanelView,
  type TaskPanelSectionState,
} from "@nervekit/workbench-ui";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
import { createSandboxTaskPanelAdapter } from "../../state/sandbox-task-panel-adapter.svelte";
import type { SandboxDetailState } from "../../state/sandbox-ui-types";
import { sandboxUtilitySectionPreferences } from "../../state/sandbox-utility-section-preferences.svelte";

let {
  record,
  detail,
}: {
  record: ManagedSandboxRecord;
  detail?: SandboxDetailState;
} = $props();

const store = useSandboxManagerStore();
const adapter = createSandboxTaskPanelAdapter(
  store,
  () => record,
  () => detail,
);
const sectionState = $derived<TaskPanelSectionState>({
  pinned: sandboxUtilitySectionPreferences.isOpen("tasks.pinned"),
  running: sandboxUtilitySectionPreferences.isOpen("tasks.running"),
  needsCleanup: sandboxUtilitySectionPreferences.isOpen("tasks.needsCleanup"),
  finished: sandboxUtilitySectionPreferences.isOpen("tasks.finished"),
});
</script>

<TaskUtilityPanelView
  model={adapter.model}
  actions={adapter.actions}
  {sectionState}
  onSectionOpenChange={(section, open) =>
    sandboxUtilitySectionPreferences.setOpen(`tasks.${section}`, open)}
/>
