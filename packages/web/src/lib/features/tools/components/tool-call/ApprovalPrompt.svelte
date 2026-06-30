<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import X from "@lucide/svelte/icons/x";
  import type { ApprovalWithToolCall } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import type { MetaItem, MetaTone } from "$lib/features/tools/views/tool-presentation";
  import ToolFooter from "./ToolFooter.svelte";

  type Props = {
    approval: ApprovalWithToolCall;
    detailsAction?: { label: string; onClick: () => void };
    onGrantApproval?: (id: string) => void;
    onDenyApproval?: (id: string) => void;
  };
  let { approval, detailsAction, onGrantApproval, onDenyApproval }: Props = $props();

  function riskTone(risk: string | undefined): MetaTone {
    if (risk === "destructive" || risk === "secret" || risk === "deployment") return "error";
    if (risk === "command" || risk === "network" || risk === "workspace_write") return "warning";
    if (risk === "agent_spawn") return "info";
    return "default";
  }

  const meta = $derived<MetaItem[]>([{ text: approval.risk, tone: riskTone(approval.risk) }]);
</script>

<div class="grid gap-1.5" aria-label="Tool approval">
  {#if approval.reason}
    <p class="m-0 text-sm text-muted-foreground">{approval.reason}</p>
  {/if}
  <ToolFooter {meta} {detailsAction}>
    {#snippet actions()}
      <Button size="sm" onclick={() => onGrantApproval?.(approval.id)}>
        <Check size={14} strokeWidth={2.4} />Approve
      </Button>
      <Button size="sm" variant="secondary" onclick={() => onDenyApproval?.(approval.id)}>
        <X size={14} strokeWidth={2.4} />Deny
      </Button>
    {/snippet}
  </ToolFooter>
</div>
