<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import type { AgentProfileDiagnostic } from "@nervekit/contracts/agent-profiles";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import { cn } from "@nervekit/ui-kit/utils";
import { profileDiagnosticSummary } from "./agent-profile-rows";

/** A readable diagnostic summary; structured validator payloads stay behind "Technical details". */
let {
  diagnostic,
  tinted = false,
}: {
  diagnostic: AgentProfileDiagnostic;
  /** Colour the summary by severity, for rows without their own message surface. */
  tinted?: boolean;
} = $props();

const summary = $derived(profileDiagnosticSummary(diagnostic));
</script>

<div class="grid min-w-0 gap-0.5">
  <p
    class={cn(
      "text-xs whitespace-pre-wrap break-words",
      tinted &&
        (diagnostic.severity === "blocking"
          ? "text-destructive"
          : "text-warning"),
    )}
  >
    {summary}
  </p>
  {#if summary !== diagnostic.message}
    <Collapsible.Root class="min-w-0">
      <Collapsible.Trigger
        class="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          class="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
          aria-hidden="true"
        />
        Technical details
      </Collapsible.Trigger>
      <Collapsible.Content>
        <pre
          class="mt-1 max-h-40 overflow-auto rounded-sm bg-well p-2 font-mono text-xs whitespace-pre-wrap break-all select-text">{diagnostic.message}</pre>
      </Collapsible.Content>
    </Collapsible.Root>
  {/if}
</div>
