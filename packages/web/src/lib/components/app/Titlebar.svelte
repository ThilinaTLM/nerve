<script lang="ts">
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import Settings2 from "lucide-svelte/icons/settings-2";
  import { Toolbar } from "bits-ui";
  import type { AgentRecord, ProcessRecord, ProjectRecord, SessionRecord } from "../../api";
  import Button from "../ui/Button.svelte";
  import StatusDot from "../ui/StatusDot.svelte";
  import StatusPopover from "./StatusPopover.svelte";

  type AppRoute = "workspace" | "settings";

  type Props = {
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    activeAgent?: AgentRecord;
    processes?: ProcessRecord[];
    branchDepth?: number;
    activeRoute?: AppRoute;
    connection?: string;
    live?: boolean;
    pendingApprovals?: number;
    onOpenSettings?: () => void;
  };

  let {
    activeProject,
    activeSession,
    activeAgent,
    processes = [],
    branchDepth = 0,
    activeRoute = "workspace",
    connection = "connecting",
    live = false,
    pendingApprovals = 0,
    onOpenSettings,
  }: Props = $props();

  const contextLabel = $derived(activeProject?.name ?? "No project");
  const sessionLabel = $derived(
    activeRoute === "settings" ? "Settings" : activeSession?.title ?? "No active session",
  );
  const agentStatus = $derived(activeAgent?.status ?? "idle");
  const agentDetail = $derived(
    activeAgent ? `${activeAgent.mode} · ${activeAgent.permissionLevel}` : "agent pending",
  );
  const statusTone = $derived(
    agentStatus === "running" ? "running" : agentStatus === "error" ? "danger" : "neutral",
  );
</script>

<header class="titlebar">
  <div class="title-left">
    <span class="app-name">Nerve</span>
    <span class="divider" aria-hidden="true"></span>
    <nav class="breadcrumb" aria-label="Breadcrumb" title={activeProject?.dir}>
      <span class="crumb">{activeRoute === "settings" ? "nerve" : contextLabel}</span>
      <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
      <span class="crumb current">{sessionLabel}</span>
    </nav>
    {#if activeRoute === "workspace"}
      <span class="agent-pill" title={agentDetail}>
        <StatusDot tone={statusTone} pulse={agentStatus === "running"} />
        <span class="agent-status">{agentStatus}</span>
      </span>
    {/if}
  </div>

  <Toolbar.Root class="title-actions" aria-label="Application actions">
    <StatusPopover
      {connection}
      {live}
      {activeAgent}
      {activeSession}
      {activeProject}
      {processes}
      {branchDepth}
      {pendingApprovals}
    />
    <Button
      variant="icon"
      size="icon"
      ariaLabel="Open settings"
      title="Open settings"
      active={activeRoute === "settings"}
      pressed={activeRoute === "settings"}
      onclick={() => {
        if (activeRoute !== "settings") onOpenSettings?.();
      }}
    >
      <Settings2 size={16} strokeWidth={2.1} />
    </Button>
  </Toolbar.Root>
</header>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    height: var(--size-header);
    border-bottom: 1px solid hsl(var(--border));
    background: hsl(var(--card));
    padding: 0 0.75rem;
    user-select: none;
  }

  .title-left,
  :global(.title-actions) {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.625rem;
  }

  :global(.title-actions) {
    flex: none;
    gap: 0.375rem;
  }

  .app-name {
    color: hsl(var(--foreground));
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    letter-spacing: -0.01em;
  }

  .divider {
    width: 1px;
    height: 1.25rem;
    background: hsl(var(--border));
  }

  .breadcrumb {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    gap: 0.375rem;
    font-size: var(--text-sm);
  }

  .breadcrumb :global(svg) {
    flex: none;
    color: hsl(var(--muted-foreground) / 70%);
  }

  .crumb {
    overflow: hidden;
    max-width: 18rem;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: hsl(var(--muted-foreground));
  }

  .crumb.current {
    color: hsl(var(--foreground));
    font-weight: var(--weight-medium);
  }

  .agent-pill {
    display: inline-flex;
    align-items: center;
    flex: none;
    gap: 0.4rem;
    height: var(--control-height-xs);
    border: 1px solid hsl(var(--border));
    border-radius: 999px;
    background: hsl(var(--secondary));
    padding: 0 0.55rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-xs);
  }

  .agent-status {
    text-transform: capitalize;
  }

  @media (max-width: 760px) {
    .agent-pill,
    .crumb.current {
      display: none;
    }
  }
</style>
