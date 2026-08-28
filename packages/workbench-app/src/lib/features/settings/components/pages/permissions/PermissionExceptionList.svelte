<script lang="ts">
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
  onRemove?: (id: string) => void;
};

let { rules, pendingIds = [], emptyTitle, onRemove }: Props = $props();

function matcher(rule: PermissionRule): string {
  const filter = rule.when;
  if (filter.toolNames?.length) return filter.toolNames.join(", ");
  if (filter.baseRisks?.length) return `risk: ${filter.baseRisks.join(", ")}`;
  if (filter.toolGroups?.length)
    return `group: ${filter.toolGroups.join(", ")}`;
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
      class="grid grid-cols-[minmax(7rem,1fr)_5rem_6rem_4rem_2rem] items-center gap-3 px-3 text-xs font-medium text-muted-foreground"
      aria-hidden="true"
    >
      <span>Matcher</span><span>Decision</span><span>Enforcement</span><span
        >Priority</span
      ><span></span>
    </div>
    <SettingsList ariaLabel="Permission rules" divided={false} gap="sm">
      {#each rules as rule (rule.id)}
        <div
          role="listitem"
          class="grid grid-cols-[minmax(7rem,1fr)_5rem_6rem_4rem_2rem] items-center gap-3 rounded-md border border-transparent bg-accent/90 px-3 py-2 dark:bg-accent/60"
        >
          <span class="truncate text-xs text-foreground" title={matcher(rule)}
            >{matcher(rule)}</span
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
      {/each}
    </SettingsList>
  </div>
{/if}
