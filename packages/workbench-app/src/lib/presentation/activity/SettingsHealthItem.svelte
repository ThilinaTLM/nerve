<!-- The persistent "Settings need attention" entry of the activity list. -->
<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type {
  SettingsDocumentId,
  SettingsHealth,
} from "@nervekit/contracts/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";

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

const authorization = $derived(
  health.invalid.some(
    (item) => item.id === "harness" || item.id === "permissions",
  ),
);
</script>

<section
  class="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 rounded-md py-2 pl-0.5 pr-1"
  aria-label="Settings need attention"
  data-testid="settings-health-item"
>
  <TriangleAlert class="mt-0.5 size-4 text-warning" aria-hidden="true" />
  <div class="grid min-w-0 gap-2">
    <p class="text-sm font-medium">Settings need attention</p>
    {#if health.invalid.length}
      <p class="text-xs text-muted-foreground">
        Nerve is using defaults for these files. Your originals are unchanged.
        Fix a file and Reload, or reset it; the original will be kept in
        quarantine.
        {#if authorization}
          Tool execution requires explicit approval until authorization settings
          are resolved.
        {/if}
      </p>
    {/if}
    <ul class="grid gap-3">
      {#each health.invalid as item (item.id)}
        <li class="grid gap-1">
          <span class="text-sm">{item.id}.json</span>
          <code class="font-mono text-xs break-all text-muted-foreground"
            >{item.path}</code
          >
          <p class="text-xs break-words text-muted-foreground">{item.reason}</p>
          <div class="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onclick={() => onReset(item.id)}>Reset to defaults</Button
            >
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onclick={() => onReload(item.id)}>Reload</Button
            >
          </div>
        </li>
      {/each}
    </ul>
    {#if error}
      <p role="alert" class="text-xs text-destructive">{error}</p>
      <div>
        <Button size="sm" variant="ghost" disabled={pending} onclick={onRetry}
          >Retry</Button
        >
      </div>
    {/if}
  </div>
</section>
