<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { AgentProfileDiagnostic } from "@nervekit/contracts/agent-profiles";
import { cn } from "@nervekit/ui-kit/utils";

/** One readable diagnostic line, coloured by severity. */
let { diagnostic }: { diagnostic: AgentProfileDiagnostic } = $props();
</script>

<p
  class={cn(
    "flex items-start gap-1 text-xs break-words",
    diagnostic.severity === "blocking" ? "text-destructive" : "text-warning",
  )}
>
  <TriangleAlert class="mt-0.5 size-3 flex-none" aria-hidden="true" />
  {diagnostic.message}
</p>
