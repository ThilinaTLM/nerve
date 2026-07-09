<script lang="ts">
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Badge } from "@nervekit/shared-ui/components/ui/badge";
  import { StatusDot } from "@nervekit/shared-ui/components/ui/status-dot";
  import {
    sandboxContainerState,
    sandboxLifecycleState,
  } from "../state/sandbox-lifecycle";
  import {
    lifecycleStateLabel,
    lifecycleStateTone,
    observedStateLabel,
    observedStateTone,
    type SandboxStatusTone,
  } from "../state/sandbox-status";
  import type { SandboxDetailState } from "../state/sandbox-ui-types";

  let {
    record,
    detail,
  }: { record: ManagedSandboxRecord; detail?: SandboxDetailState } = $props();

  const lifecycle = $derived(sandboxLifecycleState(record, detail));
  const state = $derived(sandboxContainerState(record, detail) ?? record.observedState);
  const tone = $derived<SandboxStatusTone>(
    lifecycle ? lifecycleStateTone(lifecycle) : observedStateTone(state),
  );
  const label = $derived(
    lifecycle ? lifecycleStateLabel(lifecycle) : observedStateLabel(state),
  );
</script>

<Badge {tone} size="xs" class="gap-1.5">
  <StatusDot
    {tone}
    size="xs"
    pulse={tone === "running"}
  />
  {label}
</Badge>
