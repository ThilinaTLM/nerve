<script lang="ts">
  import AppWindow from "lucide-svelte/icons/app-window";
  import Settings2 from "lucide-svelte/icons/settings-2";
  import { Toolbar } from "bits-ui";
  import type { AgentRecord, ProcessRecord, ProjectRecord, SessionRecord } from "../../api";
  import Button from "../ui/Button.svelte";
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
  const title = $derived(`${activeProject?.dir ?? "No project"}${activeSession ? ` / ${activeSession.id}` : ""}`);
</script>

<header class="titlebar">
  <div class="title-left">
    <span class="app-mark" aria-hidden="true"><AppWindow size={13} strokeWidth={2.2} /></span>
    <span class="app-name">nerve</span>
    <span class="divider" aria-hidden="true"></span>
    <span class="context" {title}>
      <span>{contextLabel}</span>
      <b>/</b>
      <span>{sessionLabel}</span>
    </span>
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
    box-shadow: var(--shadow-panel);
    padding: 0 0.45rem;
    user-select: none;
  }

  .title-left,
  :global(.title-actions) {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.42rem;
  }

  :global(.title-actions) {
    flex: none;
  }

  .app-mark {
    display: inline-grid;
    width: 1.25rem;
    height: 1.25rem;
    place-items: center;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-accent);
  }

  .app-name {
    color: var(--color-text);
    font-family: var(--font-display);
    font-size: var(--text-sm);
    font-weight: var(--weight-bold);
    letter-spacing: 0.015em;
  }

  .divider {
    width: 1px;
    height: 0.95rem;
    background: var(--color-border-subtle);
  }

  .context {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.32rem;
    overflow: hidden;
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .context span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context span:first-child {
    color: var(--color-text);
    font-weight: var(--weight-semibold);
  }

  .context b {
    color: var(--color-faint);
    font-weight: var(--weight-medium);
  }

  @media (max-width: 760px) {
    .context b,
    .context span:last-child {
      display: none;
    }
  }
</style>
