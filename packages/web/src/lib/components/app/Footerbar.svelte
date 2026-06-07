<script lang="ts">
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";
  import PanelRight from "@lucide/svelte/icons/panel-right";
  import PanelRightClose from "@lucide/svelte/icons/panel-right-close";
  import Terminal from "@lucide/svelte/icons/terminal";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type {
    AgentRecord,
    ProcessRecord,
    ProjectRecord,
    ConversationRecord,
    SubscriptionUsage,
  } from "../../api";
  import { shortenPath } from "../../utils/path";
  import { Button } from "$lib/components/ui/button";
  import StatusPopover from "./StatusPopover.svelte";
  import SubscriptionUsageChip from "./SubscriptionUsageChip.svelte";
  import ZoomControl from "./ZoomControl.svelte";

  type GitStatus = { branch: string; dirty: boolean };

  type Props = {
    activeProject?: ProjectRecord;
    activeConversation?: ConversationRecord;
    activeAgent?: AgentRecord;
    connection?: string;
    live?: boolean;
    pendingApprovals?: number;
    processes?: ProcessRecord[];
    branchDepth?: number;
    gitStatus?: GitStatus;
    subscriptionUsage?: SubscriptionUsage;
    homeDir?: string;
    zoomLevel?: number;
    sidebarCollapsed?: boolean;
    utilityCollapsed?: boolean;
    onZoomLevelChange?: (level: number) => void;
    onToggleSidebar?: () => void;
    onToggleUtility?: () => void;
  };

  let {
    activeProject,
    activeConversation,
    activeAgent,
    connection = "connecting",
    live = false,
    pendingApprovals = 0,
    processes = [],
    branchDepth = 0,
    gitStatus,
    subscriptionUsage,
    homeDir,
    zoomLevel = 0,
    sidebarCollapsed = false,
    utilityCollapsed = false,
    onZoomLevelChange,
    onToggleSidebar,
    onToggleUtility,
  }: Props = $props();

  const activeProcesses = $derived(
    processes.filter((process) =>
      ["starting", "running", "ready", "stopping"].includes(process.status),
    ).length,
  );
  const projectPath = $derived(
    activeProject ? shortenPath(activeProject.dir, homeDir) : "No project",
  );
</script>

<footer class="footerbar">
  <div class="footer-group">
    <Button
      variant="ghost"
      size="icon-sm"
      class="footer-toggle"
      ariaLabel="Toggle agents panel"
      title={sidebarCollapsed ? "Show agents panel" : "Hide agents panel"}
      pressed={!sidebarCollapsed}
      onclick={() => onToggleSidebar?.()}
    >
      {#if sidebarCollapsed}
        <PanelLeft size={13} strokeWidth={2.1} aria-hidden="true" />
      {:else}
        <PanelLeftClose size={13} strokeWidth={2.1} aria-hidden="true" />
      {/if}
    </Button>
    <span class="footer-path" title={activeProject?.dir}>{projectPath}</span>
  </div>

  <div class="footer-group footer-right">
    {#if gitStatus}
      <span class="footer-chip" title="Git branch">
        <GitBranch size={12} strokeWidth={2.1} aria-hidden="true" />
        <span>{gitStatus.branch}{gitStatus.dirty ? "*" : ""}</span>
      </span>
    {/if}

    {#if activeProcesses > 0}
      <span class="footer-chip" title="Running processes">
        <Terminal size={12} strokeWidth={2.1} aria-hidden="true" />
        <span>{activeProcesses}</span>
      </span>
    {/if}

    {#if pendingApprovals > 0}
      <span class="footer-chip warn" title="Pending approvals">
        <TriangleAlert size={12} strokeWidth={2.1} aria-hidden="true" />
        <span>{pendingApprovals}</span>
      </span>
    {/if}

    <SubscriptionUsageChip usage={subscriptionUsage} />

    <ZoomControl {zoomLevel} {onZoomLevelChange} />

    <StatusPopover
      {connection}
      {live}
      {activeAgent}
      {activeConversation}
      {activeProject}
      {processes}
      {branchDepth}
      {pendingApprovals}
      side="top"
    />

    <Button
      variant="ghost"
      size="icon-sm"
      class="footer-toggle"
      ariaLabel="Toggle utility panel"
      title={utilityCollapsed ? "Show utility panel" : "Hide utility panel"}
      pressed={!utilityCollapsed}
      onclick={() => onToggleUtility?.()}
    >
      {#if utilityCollapsed}
        <PanelRight size={13} strokeWidth={2.1} aria-hidden="true" />
      {:else}
        <PanelRightClose size={13} strokeWidth={2.1} aria-hidden="true" />
      {/if}
    </Button>
  </div>
</footer>

<style>
  .footerbar {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: 0;
    height: 1.75rem;
    min-width: 0;
    border-top: 1px solid var(--border);
    background: var(--sidebar);
    color: var(--muted-foreground);
    padding: 0;
    font-size: var(--text-xs);
    user-select: none;
  }

  .footer-group {
    display: flex;
    align-items: center;
    height: 100%;
    min-width: 0;
    gap: 0.4rem;
    padding-left: 0.15rem;
  }

  .footer-right {
    flex: none;
    gap: 0;
    padding-left: 0;
  }

  .footer-right > :global(*) {
    display: inline-flex;
    align-items: center;
    height: 100%;
    border-left: 1px solid var(--border);
  }

  .footer-right > :global(*:first-child) {
    border-left: 0;
  }

  .footer-path {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .footer-chip {
    display: inline-flex;
    align-items: center;
    flex: none;
    gap: 0.3rem;
    height: 100%;
    padding: 0 0.6rem;
  }

  .footer-chip :global(svg) {
    color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
  }

  .footer-chip.warn {
    color: var(--warning);
  }

  .footer-chip.warn :global(svg) {
    color: var(--warning);
  }

  :global(.footer-toggle) {
    width: 1.5rem;
    height: 1.5rem;
  }
</style>
