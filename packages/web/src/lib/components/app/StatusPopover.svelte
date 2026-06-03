<script lang="ts">
  import Activity from "lucide-svelte/icons/activity";
  import Bot from "lucide-svelte/icons/bot";
  import GitBranch from "lucide-svelte/icons/git-branch";
  import Radio from "lucide-svelte/icons/radio";
  import Terminal from "lucide-svelte/icons/terminal";
  import TriangleAlert from "lucide-svelte/icons/triangle-alert";
  import type { AgentRecord, ProcessRecord, ProjectRecord, SessionRecord } from "../../api";
  import Badge from "../ui/Badge.svelte";
  import Popover from "../ui/Popover.svelte";
  import StatusDot from "../ui/StatusDot.svelte";
  import { pulseForStatus, statusTone, type StatusTone } from "../../utils/status";

  type Props = {
    connection?: string;
    live?: boolean;
    pendingApprovals?: number;
    processes?: ProcessRecord[];
    branchDepth?: number;
    activeAgent?: AgentRecord;
    activeSession?: SessionRecord;
    activeProject?: ProjectRecord;
  };

  let {
    connection = "connecting",
    live = false,
    pendingApprovals = 0,
    processes = [],
    branchDepth = 0,
    activeAgent,
    activeSession,
    activeProject,
  }: Props = $props();

  const activeProcesses = $derived(
    processes.filter((process) => ["starting", "running", "ready", "stopping"].includes(process.status)).length,
  );
  const connectionTone = $derived<StatusTone>(live ? "good" : connection === "error" ? "danger" : connection === "closed" ? "warn" : "neutral");
  const summary = $derived(live ? "Connected" : connection);
  const modelLabel = $derived(activeAgent?.model ? `${activeAgent.model.provider}/${activeAgent.model.modelId}` : "model pending");
</script>

<Popover class="status-popover" triggerClass="status-trigger-wrap" ariaLabel="Open status details" side="bottom" align="end">
  {#snippet trigger()}
    <span class="status-trigger" title="Open status details">
      <StatusDot tone={connectionTone} pulse={live} />
      <span>{summary}</span>
      {#if pendingApprovals > 0}
        <Badge size="xs" tone="warn"><TriangleAlert size={10} strokeWidth={2.3} />{pendingApprovals}</Badge>
      {/if}
    </span>
  {/snippet}

  <div class="status-card">
    <header>
      <div>
        <strong>Runtime status</strong>
        <span>Daemon, approvals, processes, and active agent.</span>
      </div>
      <Badge size="xs" tone={connectionTone}>{summary}</Badge>
    </header>

    <div class="status-grid">
      <section>
        <span><StatusDot tone={connectionTone} />Connection</span>
        <strong>{connection}</strong>
      </section>
      <section>
        <span><TriangleAlert size={12} strokeWidth={2.2} />Approvals</span>
        <strong>{pendingApprovals} pending</strong>
      </section>
      <section>
        <span><Terminal size={12} strokeWidth={2.2} />Processes</span>
        <strong>{activeProcesses}/{processes.length} active</strong>
      </section>
      <section>
        <span><GitBranch size={12} strokeWidth={2.2} />Branch depth</span>
        <strong>{branchDepth}</strong>
      </section>
      <section>
        <span><Bot size={12} strokeWidth={2.2} />Agent</span>
        <strong>{activeAgent ? `${activeAgent.status} · ${activeAgent.mode}` : "no agent"}</strong>
      </section>
      <section>
        <span>{#if live}<Radio size={12} strokeWidth={2.2} />{:else}<Activity size={12} strokeWidth={2.2} />{/if}Model</span>
        <strong>{modelLabel}</strong>
      </section>
    </div>

    <div class="context-list">
      <div><span>Project</span><strong title={activeProject?.dir}>{activeProject?.name ?? "No project"}</strong></div>
      <div><span>Session</span><strong title={activeSession?.id}>{activeSession?.title ?? "No active session"}</strong></div>
      <div><span>Permission</span><strong>{activeAgent?.permissionLevel ?? activeSession?.permissionLevel ?? "—"}</strong></div>
    </div>

    {#if processes.length > 0}
      <div class="process-slice">
        {#each processes.slice(0, 4) as process}
          <div>
            <StatusDot tone={statusTone(process.status)} size="xs" pulse={pulseForStatus(process.status)} />
            <span>{process.name ?? process.command}</span>
            <small>{process.status}</small>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</Popover>

<style>
  .status-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: var(--control-height-sm);
    border: 1px solid hsl(var(--border) / 0.6);
    border-radius: 999px;
    background: hsl(var(--input));
    color: hsl(var(--muted-foreground));
    padding: 0 0.55rem;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
  }

  :global(.status-trigger-wrap:hover) .status-trigger,
  :global(.status-trigger-wrap[data-state="open"]) .status-trigger {
    border-color: hsl(var(--border));
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
  }

  .status-card {
    display: grid;
    gap: 0.7rem;
    padding: 0.75rem;
  }

  header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 0.8rem;
    border-bottom: 1px solid hsl(var(--border) / 0.6);
    padding-bottom: 0.65rem;
  }

  header div,
  .context-list div {
    display: grid;
    min-width: 0;
    gap: 0.1rem;
  }

  header strong {
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }

  header span,
  .status-grid span,
  .context-list span,
  .process-slice small {
    color: hsl(var(--muted-foreground));
    font-size: var(--text-xs);
  }

  .status-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.42rem;
  }

  .status-grid section {
    display: grid;
    gap: 0.16rem;
    border: 1px solid hsl(var(--border) / 0.6);
    border-radius: var(--radius-sm);
    background: hsl(var(--input));
    padding: 0.55rem;
  }

  .status-grid span {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .status-grid strong,
  .context-list strong {
    overflow: hidden;
    color: hsl(var(--foreground));
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context-list,
  .process-slice {
    display: grid;
    gap: 0.36rem;
  }

  .context-list,
  .process-slice {
    border-top: 1px solid hsl(var(--border) / 0.6);
    padding-top: 0.6rem;
  }

  .process-slice div {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.35rem;
  }

  .process-slice span {
    overflow: hidden;
    color: hsl(var(--foreground));
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
