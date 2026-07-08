<script lang="ts">
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Badge } from "@nervekit/shared-ui/components/ui/badge";
  import { StatusDot } from "@nervekit/shared-ui/components/ui/status-dot";
  import { observedStateLabel, observedStateTone } from "../state/sandbox-status";

  let { record }: { record: ManagedSandboxRecord } = $props();

  const tone = $derived(observedStateTone(record.observedState));
  const label = $derived(observedStateLabel(record.observedState));
</script>

<Badge {tone} size="xs" class="gap-1.5">
  <StatusDot
    {tone}
    size="xs"
    pulse={record.observedState === "starting" ||
      record.observedState === "reconnecting"}
  />
  {label}
</Badge>
