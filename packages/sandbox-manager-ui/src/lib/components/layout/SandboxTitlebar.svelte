<script lang="ts">
  import Boxes from "@lucide/svelte/icons/boxes";
  import Plus from "@lucide/svelte/icons/plus";
  import Settings from "@lucide/svelte/icons/settings";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { WorkbenchTitlebar } from "@nervekit/ui/components/workbench";
  import { useSandboxCenter } from "../../state/sandbox-center.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";

  const store = useSandboxManagerStore();
  const center = useSandboxCenter();

  const settingsActive = $derived(center.mode === "settings");
</script>

<WorkbenchTitlebar>
  {#snippet left()}
    <span class="brand">
      <Boxes size={19} strokeWidth={2.1} aria-hidden="true" />
      <span class="project-button-label">Sandbox</span>
    </span>
    <span class="divider" aria-hidden="true"></span>
    <Button
      variant="ghost"
      size="sm"
      class="project-button"
      ariaLabel="Create sandbox"
      title="Create sandbox"
      onclick={() => (store.createDialogOpen = true)}
    >
      <Plus size={14} strokeWidth={2.1} aria-hidden="true" />
      <span class="project-button-label">Create Sandbox</span>
    </Button>
  {/snippet}

  {#snippet actions()}
    <div class="title-actions" aria-label="Sandbox actions">
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Open settings"
        title="Settings"
        active={settingsActive}
        pressed={settingsActive}
        onclick={() => center.openSettings()}
      >
        <Settings size={16} strokeWidth={2.1} />
      </Button>
    </div>
  {/snippet}
</WorkbenchTitlebar>
