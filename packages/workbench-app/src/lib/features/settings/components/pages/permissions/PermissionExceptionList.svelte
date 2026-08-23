<script lang="ts">
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { PermissionException } from "$lib/api";
import {
  SettingsEmptyState,
  SettingsList,
  SettingsSummaryRow,
} from "$lib/presentation/components/settings";
import {
  exceptionDetail,
  exceptionTitle,
} from "./permission-exception-presentation";

type Props = {
  exceptions: PermissionException[];
  pendingIds?: string[];
  onRemove?: (id: string) => void;
};

let { exceptions, pendingIds = [], onRemove }: Props = $props();
</script>

{#if exceptions.length === 0}
  <SettingsEmptyState
    title="No exceptions in this scope"
    description="The selected permission level uses its standard baseline."
    icon={ShieldCheck}
  />
{:else}
  <SettingsList ariaLabel="Permission exceptions">
    {#each exceptions as exception (exception.id)}
      <SettingsSummaryRow
        title={exceptionTitle(exception)}
        status={exception.effect === "allow" ? "ok" : "warning"}
      >
        {#snippet meta()}
          <span
            >{exception.effect === "allow" ? "Allow" : "Block"} · {exceptionDetail(
              exception,
            )}</span
          >
        {/snippet}
        {#snippet actions()}
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={pendingIds.includes(exception.id)}
            aria-label={`Remove ${exceptionTitle(exception)} exception`}
            onclick={() => onRemove?.(exception.id)}
          >
            {#if pendingIds.includes(exception.id)}
              <Spinner class="size-3.5" />
            {:else}
              <Trash2 class="size-3.5" />
            {/if}
          </Button>
        {/snippet}
      </SettingsSummaryRow>
    {/each}
  </SettingsList>
{/if}
