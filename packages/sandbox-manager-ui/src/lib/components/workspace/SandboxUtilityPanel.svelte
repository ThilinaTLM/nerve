<script lang="ts">
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import Info from "@lucide/svelte/icons/info";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { WorkbenchUtilityPanel } from "@nervekit/shared-ui/components/workbench";
  import type { TabItem } from "@nervekit/shared-ui/components/ui/tabs-bar";
  import {
    sandboxWorkbenchLayout,
  } from "../../state/sandbox-workbench-layout.svelte";
  import type { SandboxDiagnosticTabId, SandboxUtilityTab } from "../../state/sandbox-ui-types";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import SandboxContextUtilityTab from "./SandboxContextUtilityTab.svelte";
  import SandboxGitUtilityTab from "./SandboxGitUtilityTab.svelte";

  let {
    record,
    onOpenDiagnosticTab,
  }: {
    record: ManagedSandboxRecord;
    onOpenDiagnosticTab?: (id: SandboxDiagnosticTabId) => void;
  } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[record.sandboxId]);
  const tabs: TabItem[] = [
    { value: "git", label: "Git", icon: GitBranch },
    { value: "context", label: "Context", icon: Info },
  ];

  function setTab(tab: SandboxUtilityTab): void {
    sandboxWorkbenchLayout.utilityTab = tab;
  }
</script>

<WorkbenchUtilityPanel
  {tabs}
  bind:activeTab={sandboxWorkbenchLayout.utilityTab}
  ariaLabel="Sandbox utility panel tabs"
  onTabChange={setTab}
>
  {#snippet children(tab)}
    {#if tab === "git"}
      <SandboxGitUtilityTab {record} {detail} {onOpenDiagnosticTab} />
    {:else}
      <SandboxContextUtilityTab {record} {onOpenDiagnosticTab} />
    {/if}
  {/snippet}
</WorkbenchUtilityPanel>
