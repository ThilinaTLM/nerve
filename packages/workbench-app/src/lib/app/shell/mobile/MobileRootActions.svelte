<script lang="ts">
import Settings from "@lucide/svelte/icons/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { discoverTitlebarBadge } from "$lib/app/discover";
import { pushMobileScreen } from "./mobile-shell.svelte";

/**
 * Header action shared by the root screens: settings, without spending a tab
 * on it. Starting a chat lives in the floating "New chat" pill instead.
 */

// Discover lives under Settings on the phone, so its attention badge does too.
const discoverBadge = $derived(discoverTitlebarBadge());
</script>

<Button
  variant="ghost"
  size="icon"
  ariaLabel={discoverBadge.kind === "count"
    ? `Settings, ${discoverBadge.value} new`
    : "Settings"}
  onclick={() => pushMobileScreen({ kind: "settings" })}
>
  <span class="relative inline-flex">
    <Settings size={18} strokeWidth={1.9} />
    {#if discoverBadge.kind === "count"}
      <span
        class="absolute -right-2 -top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-warning px-1 text-ui text-warning-foreground"
        aria-hidden="true"
        >{discoverBadge.value > 99 ? "99+" : discoverBadge.value}</span
      >
    {:else if discoverBadge.kind === "dot"}
      <span
        class="absolute -right-1 -top-0.5 size-2 rounded-full bg-info"
        aria-hidden="true"
      ></span>
    {/if}
  </span>
</Button>
