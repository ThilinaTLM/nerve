<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Gavel from "@lucide/svelte/icons/gavel";
  import X from "@lucide/svelte/icons/x";
  import type { ApprovalWithToolCall } from "$lib/api";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { StatusDot } from "$lib/components/ui/status-dot";

  type Props = {
    approvals?: ApprovalWithToolCall[];
    onGrantApproval?: (id: string) => void;
    onDenyApproval?: (id: string) => void;
  };

  let {
    approvals = [],
    onGrantApproval,
    onDenyApproval,
  }: Props = $props();

  function riskTone(risk: string | undefined): "neutral" | "accent" | "good" | "warn" | "danger" | "running" {
    if (risk === "destructive" || risk === "secret" || risk === "deployment") return "danger";
    if (risk === "command" || risk === "network" || risk === "workspace_write") return "warn";
    if (risk === "agent_spawn") return "accent";
    return "neutral";
  }

  function argsPreview(approval: ApprovalWithToolCall): string {
    const args = approval.toolCall?.argsPreview;
    if (args === undefined) return "No arguments.";
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  }
</script>

{#if approvals.length > 0}
  <section class="approval-strip" aria-label="Pending tool approvals">
    <header class="strip-head">
      <div class="head-copy">
        <span class="head-icon"><Gavel size={16} strokeWidth={2.1} aria-hidden="true" /></span>
        <div>
          <strong>Action Required: Approval Needed</strong>
          <span>The agent has requested permission to proceed.</span>
        </div>
      </div>
      <Badge size="xs" tone="warn">pending</Badge>
    </header>

    <div class="approval-list">
      {#each approvals as approval}
        <article class="approval-card">
          <div class="approval-detail">
            <div class="detail-row">
              <span class="detail-label">Tool</span>
              <span class="detail-tool">{approval.toolCall?.toolName ?? "tool call"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Risk</span>
              <span class="detail-risk"><StatusDot tone={riskTone(approval.risk)} size="sm" />{approval.risk}</span>
            </div>
            <div class="detail-row align-start">
              <span class="detail-label">Reason</span>
              <span class="detail-reason">{approval.reason}</span>
            </div>
            <details class="detail-args">
              <summary>Arguments · {approval.toolCallId}</summary>
              <pre>{argsPreview(approval)}</pre>
            </details>
          </div>
          <div class="approval-actions">
            <Button size="sm" onclick={() => onGrantApproval?.(approval.id)}><Check size={14} strokeWidth={2.4} />Approve &amp; Execute</Button>
            <Button size="sm" variant="secondary" onclick={() => onDenyApproval?.(approval.id)}><X size={14} strokeWidth={2.4} />Deny</Button>
          </div>
        </article>
      {/each}
    </div>
  </section>
{/if}

<style>
  .approval-strip {
    position: relative;
    display: grid;
    gap: 0.6rem;
    overflow: hidden;
    border: 1px solid var(--accent);
    border-radius: var(--radius-lg);
    background: var(--card);
    padding: 0.75rem 0.75rem 0.75rem 0.85rem;
    box-shadow: inset 0 0 0 1px var(--accent), var(--shadow-sm);
  }

  .approval-strip::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: var(--primary);
  }

  .strip-head,
  .head-copy,
  .approval-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .strip-head {
    justify-content: space-between;
  }

  .head-copy {
    min-width: 0;
    align-items: start;
  }

  .head-icon {
    display: inline-grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--secondary);
    color: var(--secondary-foreground);
  }

  .head-copy div {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .head-copy strong {
    color: var(--foreground);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .head-copy span:not(.head-icon) {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .approval-list {
    display: grid;
    max-height: 15rem;
    gap: 0.5rem;
    overflow: auto;
  }

  .approval-card {
    display: grid;
    gap: 0.6rem;
  }

  .approval-detail {
    display: grid;
    gap: 0.42rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    padding: 0.6rem 0.65rem;
  }

  .detail-row {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem;
  }

  .detail-row.align-start {
    align-items: start;
  }

  .detail-label {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .detail-tool {
    overflow: hidden;
    color: var(--primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail-risk {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--foreground);
    font-size: var(--text-sm);
    text-transform: capitalize;
  }

  .detail-reason {
    color: var(--muted-foreground);
    font-size: var(--text-sm);
    line-height: 1.38;
  }

  .detail-args summary {
    color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .detail-args summary:hover {
    color: var(--muted-foreground);
  }

  pre {
    max-height: 7rem;
    overflow: auto;
    margin: 0.4rem 0 0;
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    border-radius: 0.25rem;
    background: var(--sidebar);
    color: var(--foreground);
    padding: 0.45rem 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.38;
    white-space: pre-wrap;
  }

  .approval-actions {
    display: flex;
    gap: 0.5rem;
  }

  .approval-actions :global(.ui-button) {
    flex: 1;
  }
</style>
