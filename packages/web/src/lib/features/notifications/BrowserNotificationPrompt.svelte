<script lang="ts">
  import Bell from "@lucide/svelte/icons/bell";
  import { Button } from "@nervekit/ui/components/ui/button";
  import {
    dismissBrowserNotificationPrompt,
    notificationState,
    requestBrowserNotificationPermission,
  } from "./notify.svelte";
</script>

{#if notificationState.promptVisible}
  <aside
    class="fixed right-4 bottom-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg"
    aria-live="polite"
    aria-label="Notification permission"
  >
    <div class="flex gap-3">
      <div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Bell class="size-4" strokeWidth={2} />
      </div>
      <div class="min-w-0 flex-1 space-y-3">
        <div class="space-y-1">
          <h2 class="text-sm font-medium">Enable desktop notifications</h2>
          <p class="text-sm text-muted-foreground">
            Let Nerve alert you when an agent needs approval, asks a question, or finishes in the background.
          </p>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onclick={dismissBrowserNotificationPrompt}>Not now</Button>
          <Button size="sm" onclick={() => void requestBrowserNotificationPermission()}>
            Enable notifications
          </Button>
        </div>
      </div>
    </div>
  </aside>
{/if}
