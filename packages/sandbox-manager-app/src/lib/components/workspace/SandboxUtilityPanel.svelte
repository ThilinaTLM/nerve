<script lang="ts">
import GitBranch from "@lucide/svelte/icons/git-branch";
import Info from "@lucide/svelte/icons/info";
import Terminal from "@lucide/svelte/icons/terminal";
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import { WorkbenchUtilityPanel } from "@nervekit/workbench-ui/components/workbench";
import type { TabItem } from "@nervekit/workbench-ui/components/ui/tabs-bar";
import { sandboxWorkbenchLayout } from "../../state/sandbox-workbench-layout.svelte";
import type {
  SandboxDiagnosticTabId,
  SandboxUtilityTab,
} from "../../state/sandbox-ui-types";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
import SandboxContextUtilityTab from "./SandboxContextUtilityTab.svelte";
import SandboxGitUtilityTab from "./SandboxGitUtilityTab.svelte";
import SandboxTasksUtilityTab from "./SandboxTasksUtilityTab.svelte";

let {
  record,
  onOpenDiagnosticTab,
}: {
  record?: ManagedSandboxRecord;
  onOpenDiagnosticTab?: (id: SandboxDiagnosticTabId) => void;
} = $props();

const store = useSandboxManagerStore();
const detail = $derived(record ? store.details[record.sandboxId] : undefined);
const runningTaskCount = $derived(
  detail?.tasks.filter((task) =>
    ["starting", "running", "ready", "stopping"].includes(task.status),
  ).length ?? 0,
);
const tabs = $derived<TabItem[]>([
  { value: "git", label: "Git", icon: GitBranch },
  {
    value: "tasks",
    label: runningTaskCount > 0 ? `Tasks ${runningTaskCount}` : "Tasks",
    icon: Terminal,
  },
  { value: "context", label: "Context", icon: Info },
]);

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
    {#if record}
      {#if tab === "git"}
        <SandboxGitUtilityTab {record} {detail} {onOpenDiagnosticTab} />
      {:else if tab === "tasks"}
        <SandboxTasksUtilityTab {record} {detail} />
      {:else}
        <SandboxContextUtilityTab {record} {onOpenDiagnosticTab} />
      {/if}
    {/if}
  {/snippet}
</WorkbenchUtilityPanel>
