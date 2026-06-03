<script lang="ts">
  import Check from "lucide-svelte/icons/check";
  import Gavel from "lucide-svelte/icons/gavel";
  import X from "lucide-svelte/icons/x";
  import type { ApprovalWithToolCall } from "../../api";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import StatusDot from "../ui/StatusDot.svelte";

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
    const args = approval.toolCall?.args;
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
    border: 1px solid hsl(var(--accent));
    border-radius: var(--radius-lg);
    background: hsl(var(--card));
    padding: 0.75rem 0.75rem 0.75rem 0.85rem;
    box-shadow: inset 0 0 0 1px hsl(var(--accent)), var(--shadow-glow);
  }

  .approval-strip::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: hsl(var(--primary));
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
    border: 1px solid hsl(var(--border));
    border-radius: 999px;
    background: hsl(var(--secondary));
    color: hsl(var(--primary));
  }

  .head-copy div {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .head-copy strong {
    color: hsl(var(--foreground));
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }

  .head-copy span:not(.head-icon) {
    color: hsl(var(--muted-foreground));
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
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-sm);
    background: hsl(var(--sidebar));
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
    color: hsl(var(--muted-foreground));
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .detail-tool {
    overflow: hidden;
    color: hsl(var(--primary));
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail-risk {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: hsl(var(--foreground));
    font-size: var(--text-sm);
    text-transform: capitalize;
  }

  .detail-reason {
    color: hsl(var(--muted-foreground));
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .detail-args summary {
    color: hsl(var(--muted-foreground) / 0.75);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    cursor: pointer;
  }

  .detail-args summary:hover {
    color: hsl(var(--muted-foreground));
  }

  pre {
    max-height: 7rem;
    overflow: auto;
    margin: 0.4rem 0 0;
    border: 1px solid hsl(var(--border) / 0.6);
    border-radius: var(--radius-xs);
    background: hsl(var(--sidebar));
    color: hsl(var(--foreground));
    padding: 0.45rem 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
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
