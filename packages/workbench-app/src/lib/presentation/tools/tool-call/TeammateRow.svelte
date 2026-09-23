<script lang="ts">
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import {
  teammatePulse,
  teammateStateLabel,
  teammateTone,
} from "../views/subagent-result-parser";
import type { SubagentTeammateView } from "../views/tool-view-types";
import SubagentTranscriptDialog from "./SubagentTranscriptDialog.svelte";

type Props = {
  teammate: SubagentTeammateView;
  /** Lead agent that owns the teammate; required to open its transcript. */
  parentAgentId?: string;
};
let { teammate, parentAgentId }: Props = $props();

let transcriptOpen = $state(false);
const tone = $derived(teammateTone(teammate));
const canOpenTranscript = $derived(Boolean(teammate.agentId && parentAgentId));
</script>

<div
  class="flex min-w-0 items-center gap-2 rounded-sm border bg-well px-2.5 py-1.5"
>
  <StatusDot
    {tone}
    pulse={teammatePulse(teammate)}
    size="xs"
    class="shrink-0"
  />
  <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
    >{teammate.name}</span
  >
  <Badge
    variant={tone}
    class={`shrink-0 ${tone === "neutral" ? "border-border bg-muted text-muted-foreground" : ""}`}
    >{teammateStateLabel(teammate)}</Badge
  >
  {#if canOpenTranscript}
    <Button
      size="xs"
      variant="outline"
      class="shrink-0 gap-1"
      onclick={() => (transcriptOpen = true)}
      aria-label={`View transcript for ${teammate.name}`}
    >
      <MessagesSquare class="size-3" aria-hidden="true" />
      Transcript
    </Button>
  {/if}
</div>

{#if canOpenTranscript && transcriptOpen}
  <SubagentTranscriptDialog
    bind:open={transcriptOpen}
    {parentAgentId}
    childAgentId={teammate.agentId}
    label={teammate.name}
  />
{/if}
