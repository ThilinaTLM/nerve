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
  const sessionLabel = $derived(activeRoute === "settings" ? "Settings" : activeSession?.title ?? "No active session");
  const agentLabel = $derived(activeAgent ? `${activeAgent.mode} · ${activeAgent.permissionLevel}` : "agent pending");
  const title = $derived(`${activeProject?.dir ?? "No project"}${activeSession ? ` / ${activeSession.id}` : ""}`);
</script>

<header class="titlebar">
  <div class="title-left">
    <span class="app-name">Nerve</span>
    <span class="divider" aria-hidden="true"></span>
    <span class="breadcrumb" {title}>
      <span>{activeRoute === "settings" ? "nerve" : contextLabel}</span>
      <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
      <span>{sessionLabel}</span>
    </span>
    {#if activeRoute === "workspace"}
      <span class="agent-pill" title={agentLabel}>
        <StatusDot tone={activeAgent?.status === "running" ? "running" : activeAgent?.status === "error" ? "danger" : "neutral"} pulse={activeAgent?.status === "running"} />
        {agentLabel}
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
      onclick={() => { if (activeRoute !== "settings") onOpenSettings?.(); }}
    >
      <Settings2 size={14} strokeWidth={2.25} />
    </Button>
  </Toolbar.Root>
</header>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--size-header);
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-titlebar);
    padding: 0 0.5rem;
    user-select: none;
  }

  .title-left,
  :global(.title-actions) {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.5rem;
  }

  :global(.title-actions) {
    flex: none;
  }

  .app-name {
    color: var(--color-accent);
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    letter-spacing: -0.01em;
  }

  .divider {
    width: 1px;
    height: 1rem;
    background: var(--color-border-subtle);
  }

  .breadcrumb,
  .agent-pill {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    gap: 0.32rem;
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .breadcrumb span {
    overflow: hidden;
    max-width: 20rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .breadcrumb span:first-child {
    color: var(--color-text);
    font-weight: var(--weight-semibold);
  }

  .breadcrumb :global(svg) {
    flex: none;
    color: var(--color-faint);
  }

  .agent-pill {
    flex: none;
    min-height: var(--control-height-xs);
    border: 1px solid var(--color-border-subtle);
    border-radius: 999px;
    background: var(--color-field);
    padding: 0 0.45rem;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }

  @media (max-width: 760px) {
    .agent-pill,
    .breadcrumb span:last-child {
      display: none;
    }
  }
</style>
