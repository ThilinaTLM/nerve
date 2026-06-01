<script lang="ts">
  import Folder from "lucide-svelte/icons/folder";
  import MessageSquare from "lucide-svelte/icons/message-square";
  import type { AgentRecord, ProcessRecord, ProjectRecord, SessionRecord } from "../../api";
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
  }: Props = $props();

  const activeProcesses = $derived(processes.filter((process) => ["starting", "running", "ready", "stopping"].includes(process.status)).length);
  const statusTone = $derived<StatusTone>(live ? "good" : connection === "error" ? "danger" : connection === "closed" ? "warn" : "neutral");
  const statusLabel = $derived(`${live ? "live" : connection}${pendingApprovals ? ` · ${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"}` : ""}${activeProcesses ? ` · ${activeProcesses} proc` : ""}`);
  const sessionLabel = $derived(activeSession?.title ?? "No active session");
  const projectLabel = $derived(activeProject?.dir ?? "No project");
  const contextTitle = $derived(`${projectLabel}${activeAgent ? ` · ${activeAgent.status} · depth ${branchDepth}` : ""}`);
</script>

<footer class="footerbar" title={contextTitle}>
  <div class="footer-section project-section">
    <Folder size={12} strokeWidth={2.2} aria-hidden="true" />
    <span>{projectLabel}</span>
  </div>

  <div class="footer-section session-section">
    <MessageSquare size={12} strokeWidth={2.2} aria-hidden="true" />
    <span>{sessionLabel}</span>
  </div>

  <div class="footer-section status-section">
    <StatusDot tone={statusTone} pulse={live} />
    <span>{statusLabel}</span>
  </div>
</footer>

<style>
  .footerbar {
    display: grid;
    grid-template-columns: minmax(8rem, 1fr) minmax(8rem, 1fr) auto;
    align-items: center;
    height: var(--size-footer);
    min-width: 0;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-titlebar);
    color: var(--color-muted);
    padding: 0 0.5rem;
    font-size: var(--text-2xs);
    user-select: none;
  }

  .footer-section {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.34rem;
  }

  .footer-section :global(svg) {
    flex: none;
    color: var(--color-faint);
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

  .status-section {
    justify-content: end;
    color: var(--color-faint);
  }

  @media (max-width: 860px) {
    .footerbar {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .session-section {
      display: none;
    }
  }
</style>
