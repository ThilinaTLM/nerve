<script lang="ts">
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import {
  GitUtilityPanelView,
  type GitPanelSectionState,
} from "@nervekit/workbench-ui";
import { createSandboxGitPanelAdapter } from "../../state/sandbox-git-panel-adapter.svelte";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
import type {
  SandboxDetailState,
  SandboxDiagnosticTabId,
} from "../../state/sandbox-ui-types";
import SandboxGitSetupSection from "./SandboxGitSetupSection.svelte";
import { sandboxUtilitySectionPreferences } from "../../state/sandbox-utility-section-preferences.svelte";

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
const sectionState = $derived<GitPanelSectionState>({
  repository: sandboxUtilitySectionPreferences.isOpen("git.repository"),
  changes: sandboxUtilitySectionPreferences.isOpen("git.changes"),
  pullRequests: sandboxUtilitySectionPreferences.isOpen("git.pullRequests"),
});
</script>

<GitUtilityPanelView
  model={adapter.model}
  actions={adapter.actions}
  {sectionState}
  onSectionOpenChange={(section, open) =>
    sandboxUtilitySectionPreferences.setOpen(`git.${section}`, open)}
/>
<div class="px-2 pb-2">
  <SandboxGitSetupSection
    {record}
    {detail}
    {onOpenDiagnosticTab}
    open={sandboxUtilitySectionPreferences.isOpen("git.setup")}
    onOpenChange={(open) =>
      sandboxUtilitySectionPreferences.setOpen("git.setup", open)}
  />
</div>
