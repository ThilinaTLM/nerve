<!--
  Shown above application settings when saved changes wait for a daemon or
  desktop restart (see `pendingRestarts`), with the daemon restart button when
  this app can restart it.
-->
<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Button } from "@nervekit/ui-kit/components/ui/button";

type Props = {
  daemon: boolean;
  desktop: boolean;
  canRestart?: boolean;
  restarting?: boolean;
  onRestart?: () => void;
};

let {
  daemon,
  desktop,
  canRestart = false,
  restarting = false,
  onRestart,
}: Props = $props();

const text = $derived(
  [
    daemon ? "Changes saved. Restart the daemon to apply them." : "",
    desktop ? "Restart Nerve to apply desktop changes." : "",
  ]
    .filter(Boolean)
    .join(" "),
);
</script>

{#if daemon || desktop}
  <div class="flex items-center gap-2">
    <Callout layout="block" class="min-w-0 flex-1" tone="warning" {text} />
    {#if daemon && canRestart}
      <Button size="sm" disabled={restarting} onclick={onRestart}>
        {restarting ? "Restarting…" : "Restart daemon"}
      </Button>
    {/if}
  </div>
{/if}
