<script lang="ts">
import {
  Toaster as Sonner,
  type ToasterProps as SonnerProps,
} from "svelte-sonner";
import { mode } from "mode-watcher";
import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
import OctagonXIcon from "@lucide/svelte/icons/octagon-x";
import InfoIcon from "@lucide/svelte/icons/info";
import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";

let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
  theme={mode.current}
  class="toaster group"
  style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border);"
  {...restProps}
>
  {#snippet loadingIcon()}
    <Spinner class="size-4" />
  {/snippet}
  {#snippet successIcon()}
    <CircleCheckIcon class="size-4" />
  {/snippet}
  {#snippet errorIcon()}
    <OctagonXIcon class="size-4" />
  {/snippet}
  {#snippet infoIcon()}
    <InfoIcon class="size-4" />
  {/snippet}
  {#snippet warningIcon()}
    <TriangleAlertIcon class="size-4" />
  {/snippet}
</Sonner>
