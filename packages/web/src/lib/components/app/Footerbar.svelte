<script lang="ts">
  import Folder from "lucide-svelte/icons/folder";
  import GitBranch from "lucide-svelte/icons/git-branch";
  import MessageSquare from "lucide-svelte/icons/message-square";
  import PanelLeft from "lucide-svelte/icons/panel-left";
  import PanelLeftClose from "lucide-svelte/icons/panel-left-close";
  import PanelRight from "lucide-svelte/icons/panel-right";
  import PanelRightClose from "lucide-svelte/icons/panel-right-close";
  import Terminal from "lucide-svelte/icons/terminal";
  import TriangleAlert from "lucide-svelte/icons/triangle-alert";
  import type { AgentRecord, ProcessRecord, ProjectRecord, SessionRecord } from "../../api";
  import Button from "../ui/Button.svelte";
  import StatusDot from "../ui/StatusDot.svelte";

  type StatusTone = "neutral" | "accent" | "good" | "warn" | "danger" | "running";

  type Props = {
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    activeAgent?: AgentRecord;
    connection?: string;
    live?: boolean;
    pendingApprovals?: number;
    processes?: ProcessRecord[];
    branchDepth?: number;
    sidebarCollapsed?: boolean;
    utilityCollapsed?: boolean;
    onToggleSidebar?: () => void;
    onToggleUtility?: () => void;
  };

  let {
    activeProject,
    activeSession,
    activeAgent,
    connection = "connecting",
    live = false,
    pendingApprovals = 0,
    processes = [],
    branchDepth = 0,
    sidebarCollapsed = false,
    utilityCollapsed = false,
    onToggleSidebar,
    onToggleUtility,
  }: Props = $props();

  const activeProcesses = $derived(processes.filter((process) => ["starting", "running", "ready", "stopping"].includes(process.status)).length);
  const statusTone = $derived<StatusTone>(live ? "good" : connection === "error" ? "danger" : connection === "closed" ? "warn" : "neutral");
  const sessionLabel = $derived(activeSession?.title ?? "No active session");
  const projectLabel = $derived(activeProject?.dir ?? "No project");
  const contextTitle = $derived(`${projectLabel}${activeAgent ? ` · ${activeAgent.status} · depth ${branchDepth}` : ""}`);
</script>

<footer class="footerbar" title={contextTitle}>
  <div class="footer-section toggle-section">
    <Button
      variant="icon"
      size="icon"
      ariaLabel="Toggle agents panel"
      title={sidebarCollapsed ? "Show agents panel" : "Hide agents panel"}
      pressed={!sidebarCollapsed}
      onclick={() => onToggleSidebar?.()}
    >
      {#if sidebarCollapsed}
        <PanelLeft size={14} strokeWidth={2.2} aria-hidden="true" />
      {:else}
        <PanelLeftClose size={14} strokeWidth={2.2} aria-hidden="true" />
      {/if}
    </Button>
  </div>

  <div class="footer-section project-section">
    <Folder size={12} strokeWidth={2.2} aria-hidden="true" />
    <span>{projectLabel}</span>
  </div>

  <div class="footer-section session-section">
    <MessageSquare size={12} strokeWidth={2.2} aria-hidden="true" />
    <span>{sessionLabel}</span>
  </div>

  <div class="footer-section metric-section">
    <Terminal size={12} strokeWidth={2.2} aria-hidden="true" />
    <span>{activeProcesses}/{processes.length} proc</span>
    <GitBranch size={12} strokeWidth={2.2} aria-hidden="true" />
    <span>depth {branchDepth}</span>
    <TriangleAlert size={12} strokeWidth={2.2} aria-hidden="true" />
    <span>{pendingApprovals} approval{pendingApprovals === 1 ? "" : "s"}</span>
  </div>

  <div class="footer-section utility-toggle-section">
    <Button
      variant="icon"
      size="icon"
      ariaLabel="Toggle utility panel"
      title={utilityCollapsed ? "Show utility panel" : "Hide utility panel"}
      pressed={!utilityCollapsed}
      onclick={() => onToggleUtility?.()}
    >
      {#if utilityCollapsed}
        <PanelRight size={14} strokeWidth={2.2} aria-hidden="true" />
      {:else}
        <PanelRightClose size={14} strokeWidth={2.2} aria-hidden="true" />
      {/if}
    </Button>
  </div>

  <div class="footer-section status-section">
    <StatusDot tone={statusTone} pulse={live} />
    <span>{live ? "connected" : connection}</span>
  </div>
</footer>

<style>
  .footerbar {
    display: grid;
    grid-template-columns: auto minmax(8rem, 1fr) minmax(8rem, 1fr) auto auto auto;
    align-items: center;
    height: var(--size-footer);
    min-width: 0;
    border-top: 1px solid var(--color-border);
    background: var(--color-bg-deep);
    color: var(--color-muted);
    padding: 0 0.75rem;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    user-select: none;
  }

  .footer-section {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.35rem;
  }

  .footer-section :global(svg) {
    flex: none;
    color: var(--color-faint);
  }

  .toggle-section {
    padding-right: 0.4rem;
  }

  .utility-toggle-section {
    justify-content: end;
    padding-right: 0.4rem;
  }

  .toggle-section :global(.ui-button),
  .utility-toggle-section :global(.ui-button) {
    width: 1.5rem;
    height: 1.5rem;
  }

  .footer-section span {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-section {
    justify-content: center;
  }

  .metric-section {
    justify-content: end;
    padding-right: 0.75rem;
  }

  .status-section {
    justify-content: end;
    color: var(--color-text);
  }

  @media (max-width: 980px) {
    .footerbar {
      grid-template-columns: auto minmax(0, 1fr) auto auto;
    }

    .session-section,
    .metric-section {
      display: none;
    }
  }
</style>
