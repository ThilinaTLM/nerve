<!-- Persistent activity entries for settings files that need attention. -->
<script lang="ts">
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import type {
  SettingsDocumentId,
  SettingsHealth,
} from "@nervekit/contracts/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ActivityEntry from "./ActivityEntry.svelte";

let {
  health,
  pending = false,
  error,
  onReset,
  onReload,
  onRetry,
}: {
  health: SettingsHealth;
  pending?: boolean;
  error?: string;
  onReset: (id: SettingsDocumentId) => void;
  onReload: (id: SettingsDocumentId) => void;
  onRetry: () => void;
} = $props();
</script>

<section
  class="grid gap-0"
  aria-label="Settings need attention"
  data-testid="settings-health-item"
>
  {#each health.invalid as item (item.id)}
    <ActivityEntry
      title={`${item.id}.json needs attention`}
      titleHint={item.path}
      description={`${item.reason.replace(/\.$/, "")} · ${
        item.id === "permissions"
          ? "Tool execution is blocked until repaired"
          : "Using defaults until repaired"
      }`}
    >
      {#snippet icon()}
        <CircleAlert class="size-4 text-destructive" aria-hidden="true" />
      {/snippet}
      {#snippet footer()}
        <Button
          size="sm"
          variant="ghost"
          class="text-muted-foreground"
          disabled={pending}
          onclick={() => onReload(item.id)}>Reload</Button
        >
        <Button
          size="sm"
          variant="ghost"
          class="text-muted-foreground"
          disabled={pending}
          onclick={() => onReset(item.id)}>Reset to defaults</Button
        >
      {/snippet}
    </ActivityEntry>
  {/each}
  {#if error}
    <ActivityEntry title="Couldn't check settings" description={error}>
      {#snippet icon()}
        <CircleAlert class="size-4 text-warning" aria-hidden="true" />
      {/snippet}
      {#snippet footer()}
        <Button
          size="sm"
          variant="ghost"
          class="text-muted-foreground"
          disabled={pending}
          onclick={onRetry}>Retry</Button
        >
      {/snippet}
    </ActivityEntry>
  {/if}
</section>
