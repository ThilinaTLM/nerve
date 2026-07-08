<script lang="ts">
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Badge } from "@nervekit/shared-ui/components/ui/badge";
  import { StatusDot } from "@nervekit/shared-ui/components/ui/status-dot";
  import {
    sandboxContainerState,
    sandboxDaemonStatus,
  } from "../state/sandbox-lifecycle";
  import {
    observedStateLabel,
    observedStateTone,
    type SandboxStatusTone,
  } from "../state/sandbox-status";
  import type { SandboxDetailState } from "../state/sandbox-ui-types";

  let {
    record,
    detail,
  }: { record: ManagedSandboxRecord; detail?: SandboxDetailState } = $props();

  const daemon = $derived(sandboxDaemonStatus(detail));
  const state = $derived(sandboxContainerState(record, detail) ?? record.observedState);
  const tone = $derived<SandboxStatusTone>(
    daemon === "offline" ? "neutral" : observedStateTone(state),
  );
  const label = $derived(
    daemon === "offline" ? "Offline" : observedStateLabel(state),
  );
</script>

<Badge {tone} size="xs" class="gap-1.5">
  <StatusDot
    {tone}
    size="xs"
    pulse={state === "starting" || state === "reconnecting"}
  />
  {label}
</Badge>
