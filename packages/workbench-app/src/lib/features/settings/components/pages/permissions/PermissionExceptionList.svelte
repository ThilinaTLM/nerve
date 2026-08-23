<script lang="ts">
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { PermissionException } from "$lib/api";
import {
  SettingsEmptyState,
  SettingsList,
} from "$lib/presentation/components/settings";

type Props = {
  exceptions: PermissionException[];
  pendingIds?: string[];
  emptyTitle: string;
  onRemove?: (id: string) => void;
};

let { exceptions, pendingIds = [], emptyTitle, onRemove }: Props = $props();
</script>

{#if exceptions.length === 0}
  <SettingsEmptyState
    title={emptyTitle}
    description="The standard permission baseline applies."
    icon={ShieldCheck}
  />
{:else}
  <div class="grid gap-1">
    <div
      class="grid grid-cols-[minmax(6rem,0.7fr)_5rem_minmax(8rem,1.5fr)_2rem] items-center gap-3 px-3 text-xs font-medium text-muted-foreground"
      aria-hidden="true"
    >
      <span>Tool</span><span>Access</span><span>Rule</span><span></span>
    </div>
    <SettingsList ariaLabel="Permission exceptions" divided={false} gap="sm">
      {#each exceptions as exception (exception.id)}
        <div
          role="listitem"
          class="grid grid-cols-[minmax(6rem,0.7fr)_5rem_minmax(8rem,1.5fr)_2rem] items-center gap-3 rounded-md border border-transparent bg-accent/90 px-3 py-2 dark:bg-accent/60"
        >
          <span
            class="truncate font-mono text-xs text-foreground"
            title={exception.tool}>{exception.tool}</span
          >
          <span
            class={exception.effect === "allow"
              ? "text-xs font-medium text-success"
              : "text-xs font-medium text-destructive"}
          >
            {exception.effect === "allow" ? "Allow" : "Deny"}
          </span>
          <span
            class="truncate font-mono text-xs text-muted-foreground"
            title={exception.rule}>{exception.rule}</span
          >
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={pendingIds.includes(exception.id)}
            aria-label={`Remove ${exception.tool} exception`}
            onclick={() => onRemove?.(exception.id)}
          >
            {#if pendingIds.includes(exception.id)}
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
