<script lang="ts">
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import { sandboxLifecycleView } from "../state/sandbox-lifecycle-view";
import type { SandboxDetailState } from "../state/sandbox-ui-types";

let {
  record,
  detail,
}: { record: ManagedSandboxRecord; detail?: SandboxDetailState } = $props();

const lifecycle = $derived(sandboxLifecycleView(record, detail));
</script>

<Badge tone={lifecycle.tone} size="xs" class="gap-1.5">
  <StatusDot
    tone={lifecycle.tone}
    size="xs"
    pulse={lifecycle.tone === "running"}
  />
  {lifecycle.label}
</Badge>
