<script lang="ts">
import Pencil from "@lucide/svelte/icons/pencil";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import type { PermissionRule } from "$lib/api";
import {
  SettingsEmptyState,
  SettingsList,
  SettingsListItem,
} from "$lib/presentation/settings";

type Props = {
  rules: PermissionRule[];
  pendingIds?: string[];
  emptyTitle: string;
  onEdit?: (rule: PermissionRule) => void;
  onRemove?: (id: string) => void;
};

let { rules, pendingIds = [], emptyTitle, onEdit, onRemove }: Props = $props();

function matcher(rule: PermissionRule): string {
  const filter = rule.when;
  if (filter.toolNames?.length) return filter.toolNames.join(", ");
  if (filter.baseRisks?.length) return `risk: ${filter.baseRisks.join(", ")}`;
  if (filter.toolGroups?.length)
    return `group: ${filter.toolGroups.join(", ")}`;
  if (filter.toolKinds?.length) return `kind: ${filter.toolKinds.join(", ")}`;
  if (filter.primaryArgument)
    return `primary argument: ${filter.primaryArgument.operator}`;
  if (filter.primaryTarget)
    return `primary target: ${filter.primaryTarget.kind}`;
  if (filter.arguments?.length) return `arguments: ${filter.arguments.length}`;
  if (filter.targets) return `targets: ${filter.targets.matcher.kind}`;
  return "All requests";
}

const decisionVariant = {
  allow: "success",
  deny: "destructive",
  prompt: "warning",
} as const;
</script>

{#if rules.length === 0}
  <SettingsEmptyState
    variant="card"
    title={emptyTitle}
    description="The selected rule set applies without an overlay at this scope."
    icon={ShieldCheck}
  />
{:else}
  <SettingsList ariaLabel="Permission overlay rules">
    {#each rules as rule (rule.id)}
      <SettingsListItem
        title={matcher(rule)}
        description={rule.description}
        class={rule.enabled ? undefined : "opacity-55"}
      >
        {#snippet status()}
          <Badge variant={decisionVariant[rule.decision]}>{rule.decision}</Badge
          >
          {#if rule.enforcement === "guardrail"}
            <Badge variant="neutral">guardrail</Badge>
          {/if}
          {#if !rule.enabled}
            <Badge variant="neutral">disabled</Badge>
          {/if}
        {/snippet}
        {#snippet detail()}
          <span class="whitespace-nowrap">Priority {rule.priority}</span>
        {/snippet}
        {#snippet actions()}
          <IconAction
            icon={Pencil}
            label="Edit rule"
            disabled={!onEdit}
            busy={pendingIds.includes(rule.id)}
            onclick={() => onEdit?.(rule)}
          />
          <IconAction
            icon={Trash2}
            label="Remove rule"
            tone="destructive"
            busy={pendingIds.includes(rule.id)}
            onclick={() => onRemove?.(rule.id)}
          />
        {/snippet}
      </SettingsListItem>
    {/each}
  </SettingsList>
{/if}
