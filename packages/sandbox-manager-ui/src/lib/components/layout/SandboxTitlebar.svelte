<script lang="ts">
  import Boxes from "@lucide/svelte/icons/boxes";
  import Monitor from "@lucide/svelte/icons/monitor";
  import Moon from "@lucide/svelte/icons/moon";
  import Settings from "@lucide/svelte/icons/settings";
  import Sun from "@lucide/svelte/icons/sun";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { WorkbenchTitlebar } from "@nervekit/ui/components/workbench";
  import SandboxActionMenu from "../SandboxActionMenu.svelte";
  import SandboxStatusBadge from "../SandboxStatusBadge.svelte";
  import { useAppearance, type ThemePreference } from "../../state/appearance.svelte";
  import type { SandboxManagerRouteState } from "../../routes/route-state.svelte";

  let {
    route,
    record,
    sandboxId,
  }: {
    route: SandboxManagerRouteState;
    record?: ManagedSandboxRecord;
    sandboxId: string;
  } = $props();

  const appearance = useAppearance();
  const themeOrder: ThemePreference[] = ["system", "light", "dark"];
  const themeIcon = $derived(
    appearance.preference === "light" ? Sun : appearance.preference === "dark" ? Moon : Monitor,
  );

  function cycleTheme(): void {
    const index = themeOrder.indexOf(appearance.preference);
    appearance.setPreference(themeOrder[(index + 1) % themeOrder.length]);
  }
</script>

<WorkbenchTitlebar>
  {#snippet left()}
    <span class="brand">
      <Boxes size={19} strokeWidth={2.1} aria-hidden="true" />
      <span class="project-button-label">Sandbox</span>
    </span>
    <span class="divider" aria-hidden="true"></span>
    <Button variant="ghost" size="sm" class="project-button" onclick={() => route.fleet()}>
      <Boxes size={14} strokeWidth={2.1} aria-hidden="true" />
      <span class="project-button-label">Sandboxes</span>
    </Button>
    <span class="divider" aria-hidden="true"></span>
    <div class="flex min-w-0 items-center gap-2">
      <div class="flex min-w-0 flex-col">
        <span class="truncate text-sm font-semibold">{record?.name ?? sandboxId}</span>
        <span class="truncate font-mono text-xs text-muted-foreground">{sandboxId}</span>
      </div>
      {#if record}<SandboxStatusBadge {record} />{/if}
    </div>
  {/snippet}

  {#snippet actions()}
    <div class="title-actions" aria-label="Sandbox actions">
      <Button variant="ghost" size="icon-sm" ariaLabel="Open settings" title="Settings" onclick={() => route.openSettings()}>
        <Settings size={16} strokeWidth={2.1} />
      </Button>
      <Button variant="ghost" size="icon-sm" ariaLabel={`Theme: ${appearance.preference}`} title={`Theme: ${appearance.preference}`} onclick={cycleTheme}>
        {@const Icon = themeIcon}
        <Icon size={16} strokeWidth={2.1} />
      </Button>
      {#if record}<SandboxActionMenu {record} compact />{/if}
    </div>
  {/snippet}
</WorkbenchTitlebar>
