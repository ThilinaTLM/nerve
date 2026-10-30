<!-- Persistent notification entries for settings files that need attention. -->
<script lang="ts">
import type {
  SettingsDocumentId,
  SettingsHealth,
} from "@nervekit/contracts/settings";
import NotificationEntry from "./NotificationEntry.svelte";

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
    <NotificationEntry
      tone="failed"
      title={`${item.id}.json needs attention`}
      titleHint={item.path}
      context={item.id === "permissions"
        ? "Tool execution is blocked until repaired"
        : "Using defaults until repaired"}
      detail={item.reason}
      actions={[
        {
          label: "Reload",
          disabled: pending,
          onSelect: () => onReload(item.id),
        },
        {
          label: "Reset to defaults",
          disabled: pending,
          onSelect: () => onReset(item.id),
        },
      ]}
    />
  {/each}
  {#if error}
    <NotificationEntry
      tone="warning"
      title="Couldn't check settings"
      detail={error}
      actions={[{ label: "Retry", disabled: pending, onSelect: onRetry }]}
    />
  {/if}
</section>
