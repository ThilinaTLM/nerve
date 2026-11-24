<!--
  Shown above application settings when saved changes wait for a daemon or
  desktop restart, with the daemon restart button when this app can restart it.
-->
<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ApplicationConfigurationSnapshot } from "@nervekit/contracts/settings";

type Props = {
  configuration: ApplicationConfigurationSnapshot;
  /** Limit to these groups of `configuration.application`; all when omitted. */
  groups?: readonly (keyof ApplicationConfigurationSnapshot["application"])[];
  canRestart?: boolean;
  restarting?: boolean;
  onRestart?: () => void;
};

let {
  configuration,
  groups,
  canRestart = false,
  restarting = false,
  onRestart,
}: Props = $props();

function pending(target: "daemon" | "desktop"): boolean {
  const application = configuration.application;
  const keys = groups ?? Object.keys(application);
  return keys.some((key) =>
    Object.values(application[key as keyof typeof application]).some(
      (item) => item.pendingRestart && item.restartTarget === target,
    ),
  );
}

const daemon = $derived(pending("daemon"));
const desktop = $derived(pending("desktop"));
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
