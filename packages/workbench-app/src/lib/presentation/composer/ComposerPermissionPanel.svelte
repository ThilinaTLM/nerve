<script lang="ts">
import { onMount } from "svelte";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Settings from "@lucide/svelte/icons/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  PopoverBody,
  PopoverHeader,
  PopoverRow,
  PopoverCommandList,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import type {
  PermissionRuleSetId,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";
import { permissionIcon } from "./composer-icons";

/** Permission rule-set list, shared by the permission picker and the compact
 * conversation-settings panel. Refreshes the rule sets each time it opens. */
let {
  activePermission,
  permissionRuleSets,
  loading = false,
  error,
  lockedBy,
  disabled = false,
  onSelect,
  onRefresh,
  onOpenSettings,
  onBack,
}: {
  activePermission: PermissionRuleSetSummary;
  permissionRuleSets: PermissionRuleSetSummary[];
  loading?: boolean;
  error?: string;
  /** Set when the applied profile locks the permission. */
  lockedBy?: string;
  disabled?: boolean;
  onSelect: (id: PermissionRuleSetId) => void;
  onRefresh?: () => void;
  onOpenSettings?: () => void;
  onBack?: () => void;
} = $props();

onMount(() => onRefresh?.());

const items = $derived(
  permissionRuleSets.map((option) => ({
    ...option,
    key: option.id,
    label: option.name,
    detail: option.description,
    group: option.source === "builtin" ? "Built-in" : "Custom",
  })),
);
</script>

<PopoverHeader title="Permissions" {onBack}>
  {#snippet actions()}
    <Button
      size="icon"
      variant="ghost"
      disabled={loading}
      ariaLabel="Refresh permission rule sets"
      title="Refresh permission rule sets"
      onclick={() => onRefresh?.()}
    >
      <RefreshCw
        class={`size-3.5 ${loading ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
    </Button>
    <Button
      size="icon"
      variant="ghost"
      ariaLabel="Open permission settings"
      title="Open permission settings"
      onclick={() => onOpenSettings?.()}
    >
      <Settings class="size-3.5" aria-hidden="true" />
    </Button>
  {/snippet}
</PopoverHeader>
{#if lockedBy || error || !activePermission.available}
  <PopoverBody>
    {#if lockedBy}
      <p class="px-1.5 text-muted-foreground">Locked by {lockedBy}.</p>
    {/if}
    {#if error}
      <p class="px-1.5 text-warning">{error}</p>
    {/if}
    {#if !activePermission.available}
      <PopoverRow
        label={activePermission.name}
        title={activePermission.description}
        selected
        disabled
      >
        {#snippet trailing()}
          <span class="flex-none text-muted-foreground">Unavailable</span>
        {/snippet}
      </PopoverRow>
    {/if}
  </PopoverBody>
{/if}
<PopoverCommandList
  {items}
  ariaLabel="Permission rule sets"
  placeholder="Search permissions"
  isSelected={(option) => option.id === activePermission.id}
  isDisabled={() => disabled || Boolean(lockedBy)}
  onChoose={(option) => onSelect(option.id)}
>
  {#snippet icon(option)}
    {@const Icon = permissionIcon(option.id)}
    <Icon class="size-3.5 flex-none text-muted-foreground" aria-hidden="true" />
  {/snippet}
</PopoverCommandList>
