<script lang="ts">
  import CheckCircle2 from "lucide-svelte/icons/check-circle-2";
  import ShieldAlert from "lucide-svelte/icons/shield-alert";
  import XCircle from "lucide-svelte/icons/x-circle";
  import type { ApprovalWithToolCall } from "../../api";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";

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
    return "neutral";
  }

  function argsPreview(approval: ApprovalWithToolCall): string {
    const args = approval.toolCall?.args;
    if (args === undefined) return "No arguments.";
    try {
      const serialized = JSON.stringify(args);
      return serialized.length > 180 ? `${serialized.slice(0, 180)}…` : serialized;
    } catch {
      return String(args);
    }
  }
</script>

{#if approvals.length > 0}
  <section class="approval-strip" aria-label="Pending tool approvals">
    <header class="strip-head">
      <div>
        <ShieldAlert size={14} strokeWidth={2.25} aria-hidden="true" />
        <strong>{approvals.length} approval{approvals.length === 1 ? "" : "s"} pending</strong>
      </div>
      <span>Review before the agent continues.</span>
    </header>

    <div class="approval-list">
      {#each approvals as approval}
        <article class="approval-row">
          <div class="approval-copy">
            <div class="approval-title">
              <strong>{approval.toolCall?.toolName ?? "tool call"}</strong>
              <Badge tone={riskTone(approval.risk)}>{approval.risk}</Badge>
            </div>
            <span>{approval.reason}</span>
            <code title={argsPreview(approval)}>{argsPreview(approval)}</code>
          </div>
          <div class="approval-actions">
            <Button size="xs" onclick={() => onGrantApproval?.(approval.id)}><CheckCircle2 size={12} strokeWidth={2.3} />Approve</Button>
            <Button size="xs" variant="secondary" onclick={() => onDenyApproval?.(approval.id)}><XCircle size={12} strokeWidth={2.3} />Deny</Button>
          </div>
        </article>
      {/each}
    </div>
  </section>
{/if}

<style>
  .approval-strip {
    display: grid;
    gap: 0.35rem;
    border: 1px solid var(--color-warn-soft);
    border-radius: var(--radius-md);
    background: var(--color-warn-soft);
    padding: 0.45rem;
  }

  .strip-head,
  .strip-head div,
  .approval-title,
  .approval-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .strip-head {
    justify-content: space-between;
    color: var(--color-warn);
    font-size: var(--text-xs);
  }

  .strip-head strong {
    color: var(--color-text);
    font-size: var(--text-sm);
  }

  .strip-head span {
    color: var(--color-muted);
  }

  .approval-list {
    display: grid;
    max-height: 9.5rem;
    gap: 0.3rem;
    overflow: auto;
  }

  .approval-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.45rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    padding: 0.42rem;
  }

  .approval-copy {
    display: grid;
    min-width: 0;
    gap: 0.2rem;
  }

  .approval-title strong,
  .approval-copy span,
  code {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .approval-title strong {
    font-size: var(--text-sm);
  }

  .approval-copy span {
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  code {
    display: block;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-code-bg);
    color: var(--color-code);
    padding: 0.25rem 0.34rem;
    font-size: var(--text-2xs);
  }

  .approval-actions {
    flex-wrap: wrap;
    justify-content: end;
  }

  @media (max-width: 720px) {
    .approval-row {
      grid-template-columns: minmax(0, 1fr);
    }

    .approval-actions {
      justify-content: start;
    }
  }
</style>
