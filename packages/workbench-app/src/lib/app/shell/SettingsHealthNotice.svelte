<script lang="ts">
import { untrack } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type {
  SettingsDocumentId,
  SettingsResolutionRequest,
} from "@nervekit/contracts/settings";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { loadCoreSettings } from "$lib/application/settings/settings-actions.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import {
  fetchSettingsHealth,
  resolveSettingsHealth,
  updateSettingsHealthNotice,
  type SettingsHealthNoticeState,
} from "$lib/application/settings/settings-health";

let resetId = $state<SettingsDocumentId>();

let notice = $state<SettingsHealthNoticeState>({
  health: { invalid: [] },
  pending: false,
});

async function refresh(): Promise<void> {
  if (notice.pending) return;
  notice = { ...notice, pending: true, error: undefined };
  notice = await updateSettingsHealthNotice(notice, fetchSettingsHealth);
}

$effect(() => {
  if (
    workbenchStartupState.progressiveActive &&
    workspaceState.connection === "connected"
  )
    untrack(() => void refresh());
});

async function resolve(request: SettingsResolutionRequest): Promise<void> {
  if (notice.pending) return;
  notice = { ...notice, pending: true, error: undefined };
  notice = await updateSettingsHealthNotice(notice, () =>
    resolveSettingsHealth(request),
  );
  // Rehydrate settings, provider metadata and open settings forms from the server.
  if (
    !notice.error &&
    !notice.health.invalid.some((item) => item.id === request.id)
  ) {
    notice = { ...notice, pending: true };
    try {
      await loadCoreSettings();
    } catch (error) {
      notice = {
        ...notice,
        error:
          error instanceof Error
            ? error.message
            : "Settings were repaired, but the workbench could not refresh them.",
      };
    } finally {
      notice = { ...notice, pending: false };
    }
  }
}
</script>

<ConfirmDialog
  open={resetId !== undefined}
  title={`Reset ${resetId ?? "settings"} to defaults?`}
  description={`This changes the active settings. The original file will be kept in quarantine.${resetId === "harness" || resetId === "permissions" ? " Resetting authorization settings ends the recovery approval safeguard once both documents are valid; the configured permission policy will apply." : ""}`}
  confirmLabel="Reset to defaults"
  onOpenChange={(open) => {
    if (!open) resetId = undefined;
  }}
  onConfirm={() => {
    if (resetId) void resolve({ id: resetId, action: "reset" });
  }}
/>

{#if notice.health.invalid.length || notice.error}
  <aside
    class="fixed inset-x-4 top-12 z-50 rounded-lg border bg-card p-3 shadow-lg sm:right-auto sm:w-80"
    aria-label="Settings need attention"
    aria-live="polite"
  >
    <div class="mb-2 flex items-center gap-2 text-sm font-semibold">
      <TriangleAlert class="size-4 text-warning" /> Settings need attention
    </div>
    {#if notice.health.invalid.length}
      <p class="mb-2 text-xs text-muted-foreground">
        Nerve is using defaults for these files. Your originals are unchanged.
        Fix a file and Reload, or reset it; the original will be kept in
        quarantine.
        {#if notice.health.invalid.some((item) => item.id === "harness" || item.id === "permissions")}
          Tool execution requires explicit approval until authorization settings
          are resolved.
        {/if}
      </p>
    {/if}
    <ScrollArea class="max-h-64">
      <ul class="grid gap-3">
        {#each notice.health.invalid as item (item.id)}
          <li class="grid gap-1">
            <span class="text-sm">{item.id}.json</span>
            <code class="font-mono text-xs break-all text-muted-foreground"
              >{item.path}</code
            >
            <p class="text-xs break-words text-muted-foreground">
              {item.reason}
            </p>
            <div class="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={notice.pending}
                onclick={() => (resetId = item.id)}>Reset to defaults</Button
              >
              <Button
                size="sm"
                variant="ghost"
                disabled={notice.pending}
                onclick={() => void resolve({ id: item.id, action: "reload" })}
                >Reload</Button
              >
            </div>
          </li>
        {/each}
      </ul>
    </ScrollArea>
    {#if notice.error}
      <p class="mt-2 text-xs text-destructive">{notice.error}</p>
      <Button
        size="sm"
        variant="ghost"
        disabled={notice.pending}
        onclick={() => void refresh()}>Retry</Button
      >
    {/if}
  </aside>
{/if}
