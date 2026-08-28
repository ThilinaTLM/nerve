<script lang="ts">
import Pencil from "@lucide/svelte/icons/pencil";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { PermissionRule } from "$lib/api";
import {
  SettingsEmptyState,
  SettingsList,
} from "$lib/presentation/components/settings";

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
</script>

{#if rules.length === 0}
  <SettingsEmptyState
    title={emptyTitle}
    description="The selected rule set applies without an overlay at this scope."
    icon={ShieldCheck}
  />
{:else}
  <div class="grid gap-1">
    <div
      class="grid grid-cols-[minmax(7rem,1fr)_5rem_6rem_4rem_4.5rem] items-center gap-3 px-3 text-xs font-medium text-muted-foreground"
      aria-hidden="true"
    >
      <span>Matcher</span><span>Decision</span><span>Enforcement</span><span
        >Priority</span
      ><span></span>
    </div>
    <SettingsList ariaLabel="Permission overlay rules" divided={false} gap="sm">
      {#each rules as rule (rule.id)}
        <div
          role="listitem"
          class:opacity-55={!rule.enabled}
          class="grid grid-cols-[minmax(7rem,1fr)_5rem_6rem_4rem_4.5rem] items-center gap-3 rounded-md border border-transparent bg-accent/90 px-3 py-2 dark:bg-accent/60"
        >
          <span class="truncate text-xs text-foreground" title={matcher(rule)}
            >{matcher(rule)}{rule.enabled ? "" : " (disabled)"}</span
          >
          <span
            class={rule.decision === "allow"
              ? "text-xs font-medium text-success"
              : rule.decision === "deny"
                ? "text-xs font-medium text-destructive"
                : "text-xs font-medium text-warning"}>{rule.decision}</span
          >
          <span class="truncate text-xs text-muted-foreground"
            >{rule.enforcement}</span
          >
          <span class="text-xs text-muted-foreground">{rule.priority}</span>
          <div class="flex justify-end gap-0.5">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={pendingIds.includes(rule.id)}
              aria-label={`Edit ${rule.id} permission rule`}
              onclick={() => onEdit?.(rule)}
            >
              <Pencil class="size-3.5" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={pendingIds.includes(rule.id)}
              aria-label={`Remove ${rule.id} permission rule`}
              onclick={() => onRemove?.(rule.id)}
            >
              {#if pendingIds.includes(rule.id)}
                <Spinner class="size-3.5" />
              {:else}
                <Trash2 class="size-3.5" />
              {/if}
            </Button>
          </div>
        </div>
      {/each}
    </SettingsList>
  </div>
{/if}
