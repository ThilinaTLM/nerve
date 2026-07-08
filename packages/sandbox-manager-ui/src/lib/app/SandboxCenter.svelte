<script lang="ts">
  import { WorkbenchFrame, WorkbenchPanes } from "@nervekit/shared-ui/components/workbench";
  import SandboxFooterbar from "../components/layout/SandboxFooterbar.svelte";
  import SandboxTitlebar from "../components/layout/SandboxTitlebar.svelte";
  import SandboxCenterTabs from "../components/workspace/SandboxCenterTabs.svelte";
  import SandboxNavigator from "../components/workspace/SandboxNavigator.svelte";
  import SandboxUtilityPanel from "../components/workspace/SandboxUtilityPanel.svelte";
  import { useSandboxCenter } from "../state/sandbox-center.svelte";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import {
    closeDrawers,
    sandboxResponsive,
    sandboxWorkbenchLayout,
    setNavDrawerOpen,
    setSidebarCollapsed,
    setUtilityCollapsed,
    setUtilityDrawerOpen,
  } from "../state/sandbox-workbench-layout.svelte";

  const store = useSandboxManagerStore();
  const centerState = useSandboxCenter();

  const record = $derived(
    centerState.selectedSandboxId
      ? store.sandboxes.find((item) => item.sandboxId === centerState.selectedSandboxId)
      : undefined,
  );
  const activeSandboxId = $derived(record?.sandboxId);

  const isCompact = $derived(sandboxResponsive.isCompact);
  const isPhone = $derived(sandboxResponsive.isPhone);
  const sidebarCollapsed = $derived(
    isCompact ? !sandboxWorkbenchLayout.navDrawerOpen : sandboxWorkbenchLayout.sidebarCollapsed,
  );
  const utilityCollapsed = $derived(
    isCompact
      ? !sandboxWorkbenchLayout.utilityDrawerOpen
      : sandboxWorkbenchLayout.utilityCollapsed,
  );

  function toggleSidebar(): void {
    if (isCompact) setNavDrawerOpen(!sandboxWorkbenchLayout.navDrawerOpen);
    else setSidebarCollapsed(!sandboxWorkbenchLayout.sidebarCollapsed);
  }

  function toggleUtility(): void {
    if (isCompact) setUtilityDrawerOpen(!sandboxWorkbenchLayout.utilityDrawerOpen);
    else setUtilityCollapsed(!sandboxWorkbenchLayout.utilityCollapsed);
  }

  $effect(() => {
    if (!isCompact && (sandboxWorkbenchLayout.navDrawerOpen || sandboxWorkbenchLayout.utilityDrawerOpen))
      closeDrawers();
  });
</script>

<WorkbenchFrame>
  {#snippet titlebar()}
    <SandboxTitlebar />
  {/snippet}

  {#snippet workspace()}
    <WorkbenchPanes
      compact={isCompact}
      {sidebarCollapsed}
      {utilityCollapsed}
      navDrawerOpen={sandboxWorkbenchLayout.navDrawerOpen}
      utilityDrawerOpen={sandboxWorkbenchLayout.utilityDrawerOpen}
      autoSaveId="nerve.sandboxManager.workbench.v1"
      leftLabel="Sandbox navigator"
      rightLabel="Sandbox utility panel"
      onNavDrawerOpenChange={setNavDrawerOpen}
      onUtilityDrawerOpenChange={setUtilityDrawerOpen}
    >
      {#snippet left()}
        <SandboxNavigator />
      {/snippet}
      {#snippet center()}
        <SandboxCenterTabs />
      {/snippet}
      {#snippet right()}
        {#if record}
          <SandboxUtilityPanel
            {record}
            onOpenDiagnosticTab={(id) =>
              activeSandboxId && store.openWorkspaceDiagnosticTab(activeSandboxId, id)}
          />
        {:else}
          <div class="h-full bg-background" aria-hidden="true"></div>
        {/if}
      {/snippet}
    </WorkbenchPanes>
  {/snippet}

  {#snippet footer()}
    <SandboxFooterbar
      {record}
      sandboxId={activeSandboxId ?? ""}
      {sidebarCollapsed}
      {utilityCollapsed}
      phone={isPhone}
      onToggleSidebar={toggleSidebar}
      onToggleUtility={toggleUtility}
    />
  {/snippet}
</WorkbenchFrame>
