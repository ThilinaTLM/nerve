<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import type { CapabilityProfileOption } from "@nervekit/contracts/capabilities";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { SelectRow } from "@nervekit/ui-kit/components/composites/select-row";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";

type Props = {
  label: string;
  enabled: boolean;
  disabled?: boolean;
  originLabel: string;
  stored: boolean;
  resetLabel: string;
  profileOptions: CapabilityProfileOption[];
  profileId?: string;
  profileMissing: boolean;
  needsProfile: boolean;
  /** Optional per-profile connection status shown beside each option. */
  profileStatus?: (
    profileId: string,
  ) => { label: string; tone: StatusTone } | undefined;
  onBack: () => void;
  onToggle: (enabled: boolean) => void;
  onProfile: (profileId: string) => void;
  onReset: () => void;
};

let {
  label,
  enabled,
  disabled = false,
  originLabel,
  stored,
  resetLabel,
  profileOptions,
  profileId,
  profileMissing,
  needsProfile,
  profileStatus,
  onBack,
  onToggle,
  onProfile,
  onReset,
}: Props = $props();
</script>

<div class="grid gap-2 px-1.5 py-1">
  <div class="flex min-w-0 items-center gap-1.5">
    <Button
      size="icon-xs"
      variant="ghost"
      ariaLabel="Back to tools"
      title="Back to tools"
      onclick={onBack}
    >
      <ArrowLeft class="size-3.5" aria-hidden="true" />
    </Button>
    <span class="min-w-0 flex-1 truncate font-medium">{label}</span>
    <Switch
      size="sm"
      checked={enabled}
      {disabled}
      aria-label={`Enable ${label} for this conversation`}
      onCheckedChange={onToggle}
    />
  </div>

  <div class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
    <span class="min-w-0 flex-1 truncate">{originLabel}</span>
    {#if stored}
      <Button size="xs" variant="ghost" {disabled} onclick={onReset}>
        <RotateCcw class="size-3.5" aria-hidden="true" />{resetLabel}
      </Button>
    {/if}
  </div>

  <div class="grid gap-1" role="group" aria-label={`${label} profile`}>
    <span class="text-xs text-muted-foreground">Profile</span>
    {#if profileMissing}
      <p class="text-xs text-destructive" role="alert">
        Profile not found on this machine. Choose another profile.
      </p>
    {:else if needsProfile}
      <p class="text-xs text-warning" role="alert">
        Choose a profile to use {label}.
      </p>
    {/if}
    {#each profileOptions as option (option.id)}
      {@const status = profileStatus?.(option.id)}
      <SelectRow
        label={option.name}
        detail={option.detail}
        selected={option.id === profileId}
        {disabled}
        onclick={() => onProfile(option.id)}
      >
        {#snippet trailing()}
          {#if status}
            <Badge variant={status.tone}>{status.label}</Badge>
          {/if}
        {/snippet}
      </SelectRow>
    {/each}
  </div>
</div>
