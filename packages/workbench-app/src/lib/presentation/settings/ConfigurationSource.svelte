<script lang="ts">
import type { FieldProvenance } from "@nervekit/contracts/agent-configuration";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import Popover, {
  PopoverBody,
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { sourceLabel, sourceChain } from "./configuration-source";
let {
  provenance,
  frozen = false,
  modelLabel,
  emptyLabel = "Unavailable",
}: {
  provenance?: FieldProvenance;
  frozen?: boolean;
  modelLabel?: string;
  emptyLabel?: string;
} = $props();
const label = $derived(
  provenance ? sourceLabel(provenance, modelLabel) : emptyLabel,
);
</script>
<Popover
  triggerClass="inline-flex"
  ariaLabel="Expand configuration source"
  triggerTitle={label}
  size="sm"
  side="bottom"
>
  {#snippet trigger()}<Badge variant="outline">{label}</Badge>{/snippet}
  <PopoverHeader title="Configuration layers" />
  <PopoverBody class="space-y-2 text-xs">
    <p class="text-muted-foreground">
      {sourceChain(provenance, frozen).join(" → ")}
    </p>
    <p>Effective source: {label}</p>
    {#if provenance?.adjusted}<p>
        Reasoning contribution: {sourceLabel({
          ...provenance,
          adjusted: false,
        })}
      </p>
      <p>
        Inherited or recommended reasoning was fitted to the effective model's
        supported levels. An incompatible requirement is a conflict, never an
        adjustment.
      </p>{/if}
    <p class="text-muted-foreground">
      Only layers with a value contribute. Reset removes your choice, not
      profile requirements.
    </p>
  </PopoverBody>
</Popover>
