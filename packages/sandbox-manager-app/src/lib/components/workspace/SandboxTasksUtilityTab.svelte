<script lang="ts">
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import { TaskUtilityPanelView } from "@nervekit/workbench-ui";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
import { createSandboxTaskPanelAdapter } from "../../state/sandbox-task-panel-adapter.svelte";
import type { SandboxDetailState } from "../../state/sandbox-ui-types";

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
</script>

<TaskUtilityPanelView model={adapter.model} actions={adapter.actions} />
