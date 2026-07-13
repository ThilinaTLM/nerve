<script lang="ts">
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import { GitUtilityPanelView } from "@nervekit/workbench-ui";
import { createSandboxGitPanelAdapter } from "../../state/sandbox-git-panel-adapter.svelte";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
import type {
  SandboxDetailState,
  SandboxDiagnosticTabId,
} from "../../state/sandbox-ui-types";
import SandboxGitSetupSection from "./SandboxGitSetupSection.svelte";

let {
  record,
  detail,
  onOpenDiagnosticTab,
}: {
  record: ManagedSandboxRecord;
  detail?: SandboxDetailState;
  onOpenDiagnosticTab?: (id: SandboxDiagnosticTabId) => void;
} = $props();

const store = useSandboxManagerStore();
const adapter = createSandboxGitPanelAdapter(
  () => record,
  () => detail,
  (repository, number) =>
    store.openWorkspacePr(record.sandboxId, repository, number),
);
</script>

<GitUtilityPanelView model={adapter.model} actions={adapter.actions} />
<div class="px-2 pb-2">
  <SandboxGitSetupSection {record} {detail} {onOpenDiagnosticTab} />
</div>
