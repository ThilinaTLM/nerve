<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { SplitButton } from "@nervekit/ui-kit/components/composites/split-button";
import type { ApprovalWithToolCall } from "../../state/tool-types";
import type { ToolArgumentPresentation } from "../lifecycle/registry";
import type { MetaItem, MetaTone } from "../views/tool-presentation";
import ToolFooter from "./ToolFooter.svelte";

type Props = {
  approval: ApprovalWithToolCall;
  toolName: string;
  presentation: ToolArgumentPresentation;
  includeBody?: boolean;
  detailsAction?: { label: string; onClick: () => void };
  onGrantApproval?: (
    id: string,
    scope?:
      | "single_call"
      | "always_conversation"
      | "always_project"
      | "always_user",
  ) => void | Promise<void>;
  onDenyApproval?: (id: string) => void | Promise<void>;
};
let {
  approval,
  presentation,
  detailsAction,
  onGrantApproval,
  onDenyApproval,
}: Props = $props();

let decision = $state<
  | "approve"
  | "always_conversation"
  | "always_project"
  | "always_user"
  | "deny"
  | undefined
>();
let actionError = $state<string | undefined>();

async function decide(
  kind:
    | "approve"
    | "always_conversation"
    | "always_project"
    | "always_user"
    | "deny",
) {
  if (decision) return;
  const callback = kind === "deny" ? onDenyApproval : onGrantApproval;
  if (!callback) return;
  decision = kind;
  actionError = undefined;
  try {
    if (kind === "deny") await callback(approval.id);
    else await callback(approval.id, kind === "approve" ? "single_call" : kind);
  } catch (error) {
    actionError =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Could not resolve the approval.";
  } finally {
    decision = undefined;
  }
}

function riskTone(risk: string | undefined): MetaTone {
  if (risk === "destructive" || risk === "secret" || risk === "deployment")
    return "error";
  if (risk === "command" || risk === "network" || risk === "workspace_write")
    return "warning";
  if (risk === "agent_spawn") return "info";
  return "default";
}

function reviewedRuleLabel(): string {
  const rule = approval.suggestedRules[0];
  if (rule) {
    const tool = rule.when.toolNames?.join(", ") ?? "matching tools";
    const primary = rule.when.primaryArgument;
    return primary?.operator === "equals"
      ? `${tool}: exact ${String(primary.value)}`
      : tool;
  }
  const exception = approval.suggestedExceptions[0];
  return exception ? `${exception.tool}: ${exception.rule}` : "this request";
}

const meta = $derived<MetaItem[]>([
  ...presentation.secondary,
  { text: approval.risk, tone: riskTone(approval.risk) },
]);
const hasSuggestion = $derived(
  approval.suggestedRules.length > 0 || approval.suggestedExceptions.length > 0,
);
const canPersistConversation = $derived(
  approval.offeredScopes.includes("always_conversation") && hasSuggestion,
);
const canPersistProject = $derived(
  approval.offeredScopes.includes("always_project") && hasSuggestion,
);
const canPersistUser = $derived(
  approval.offeredScopes.includes("always_user") && hasSuggestion,
);
const hasPersistentChoice = $derived(
  canPersistConversation || canPersistProject || canPersistUser,
);
const reviewedTarget = $derived(reviewedRuleLabel());
const permissionRuleSetLabel = $derived(
  approval.permissionRuleSetId
    ? approval.permissionRuleSetId
        .replaceAll("_", " ")
        .replace(/\b\w/g, (character) => character.toUpperCase())
    : undefined,
);
</script>

<div class="grid gap-2" aria-label="Tool approval">
  {#if permissionRuleSetLabel && hasPersistentChoice}
    <p class="text-xs text-muted-foreground">
      Durable grants apply only to the {permissionRuleSetLabel} permission rule set.
    </p>
  {/if}
  <ToolFooter {meta} {detailsAction}>
    {#snippet actions()}
      {#if hasPersistentChoice}
        <SplitButton
          size="sm"
          disabled={Boolean(decision)}
          menuAlign="end"
          menuClass="w-56"
          triggerLabel="Approval options"
          onclick={() => void decide("approve")}
        >
          {#if decision === "approve"}
            <Spinner class="size-3.5" />Approving…
          {:else}
            <Check class="size-3.5" strokeWidth={2.4} />Approve
          {/if}
          {#snippet menu()}
            <DropdownMenu.Item
              disabled={Boolean(decision)}
              onSelect={() => void decide("approve")}
            >
              Approve once
            </DropdownMenu.Item>
            {#if canPersistConversation}
              <DropdownMenu.Item
                disabled={Boolean(decision)}
                title={`Allow ${reviewedTarget} in this conversation${permissionRuleSetLabel ? ` for ${permissionRuleSetLabel}` : ""}`}
                onSelect={() => void decide("always_conversation")}
              >
                Allow in this conversation
              </DropdownMenu.Item>
            {/if}
            {#if canPersistProject}
              <DropdownMenu.Item
                disabled={Boolean(decision)}
                title={`Always approve ${reviewedTarget} in this project${permissionRuleSetLabel ? ` for ${permissionRuleSetLabel}` : ""}`}
                onSelect={() => void decide("always_project")}
              >
                Always approve in project
              </DropdownMenu.Item>
            {/if}
            {#if canPersistUser}
              <DropdownMenu.Item
                disabled={Boolean(decision)}
                title={`Always approve ${reviewedTarget} for this user${permissionRuleSetLabel ? ` in ${permissionRuleSetLabel}` : ""}`}
                onSelect={() => void decide("always_user")}
              >
                Always approve for user
              </DropdownMenu.Item>
            {/if}
          {/snippet}
        </SplitButton>
      {:else}
        <Button
          size="sm"
          disabled={Boolean(decision)}
          onclick={() => void decide("approve")}
        >
          {#if decision === "approve"}
            <Spinner class="size-3.5" />Approving…
          {:else}
            <Check class="size-3.5" strokeWidth={2.4} />Approve
          {/if}
        </Button>
      {/if}
      <Button
        size="sm"
        variant="secondary"
        disabled={Boolean(decision)}
        onclick={() => void decide("deny")}
      >
        {#if decision === "deny"}
          <Spinner class="size-3.5" />Denying…
        {:else}
          <X class="size-3.5" strokeWidth={2.4} />Deny
        {/if}
      </Button>
    {/snippet}
  </ToolFooter>
  {#if actionError}
    <p class="m-0 text-xs text-destructive" role="alert">{actionError}</p>
  {/if}
</div>
