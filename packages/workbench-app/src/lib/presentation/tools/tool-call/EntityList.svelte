<script lang="ts">
// Entity sections for a card sheet: an optional shared-context section, then
// one keyed EntityRow per item. Rows naming a live sub-agent take their dot
// from the agent and gain an Open pill. Renders sibling sections (no wrapper)
// so CardSheet's hairline dividers apply; wrap in CardSheet when standalone.
import { untrack } from "svelte";
import { getConversationUiCapabilities } from "../../context.svelte";
import { findSubagent, subagentLiveState } from "../views/subagent-live";
import SlotText from "../../cards/SlotText.svelte";
import EntityRow from "./EntityRow.svelte";
import type { EntityItem } from "./subagent-entities";
import { getToolMotion } from "./tool-motion-context";

type Props = {
  items: EntityItem[];
  context?: { label: string; text?: string };
  streaming?: boolean;
  expanded?: boolean;
};
let { items, context, streaming = false, expanded = false }: Props = $props();

const toolMotion = getToolMotion();
const streamMotion = $derived(streaming && toolMotion.streamMotion);
// Rows present at mount never enter, so remounts do not replay.
const initialCount = untrack(() => items.length);

const subagents = getConversationUiCapabilities().subagents;
const agents = $derived(subagents?.list() ?? []);
</script>

{#if context}
  <div class="px-3 py-2">
    <p
      class={`m-0 text-xs whitespace-pre-line text-muted-foreground wrap-anywhere ${expanded ? "" : "line-clamp-3"}`}
    >
      <span class="font-medium text-foreground">{context.label}</span>
      ·
      <SlotText text={context.text} width="w-64" {streaming} />
    </p>
  </div>
{/if}
{#each items as item, index (item.key)}
  {@const agent = item.agentName
    ? findSubagent(agents, item.agentName)
    : undefined}
  <EntityRow
    title={item.title}
    detail={item.detail}
    body={item.body}
    status={agent ? subagentLiveState(agent.status) : item.status}
    followUp={item.followUp}
    onOpen={agent && subagents ? () => subagents.open(agent.id) : undefined}
    {streaming}
    {expanded}
    enter={streamMotion && index >= initialCount}
  />
{/each}
