<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Crown from "@lucide/svelte/icons/crown";
import Terminal from "@lucide/svelte/icons/terminal";
import Users from "@lucide/svelte/icons/users";
import type { AsyncBash } from "@nervekit/contracts/core";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverSection,
  SelectRow,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import type {
  AgentActivitySnapshot,
  AgentRecord,
} from "$lib/presentation/view-models/conversation";
import AgentContextPercent from "./AgentContextPercent.svelte";
import {
  AGENT_STATE_LABEL,
  agentsPillSummary,
  buildAgentTeam,
  FOLD_AFTER_MS,
  type AgentRowState,
  type AgentTeamRow,
} from "./agent-team";

/**
 * Floating summary of the conversation tree: the lead and its sub-agents, plus
 * the viewed conversation's background commands. Identical in lead and
 * sub-agent views; in a sub-agent view it also names the viewed agent and
 * offers the way back.
 */
let {
  open = $bindable(false),
  agents,
  activities,
  leadTitle,
  viewedId,
  commands,
  commandOutput,
  onSelectAgent,
  onStopCommand,
}: {
  open?: boolean;
  agents: readonly AgentRecord[];
  activities: Readonly<Record<string, AgentActivitySnapshot>>;
  leadTitle: string;
  /** The conversation shown in the main view. */
  viewedId: string;
  /** Running background commands of the viewed conversation. */
  commands: readonly AsyncBash[];
  commandOutput: (command: AsyncBash) => string | undefined;
  /** Navigates the main view; the lead id returns to the lead. */
  onSelectAgent: (conversationId: string) => void;
  onStopCommand: (command: AsyncBash) => void;
} = $props();

const TICK_MS = 15_000;
let nowMs = $state(Date.now());
$effect(() => {
  const timer = setInterval(() => {
    nowMs = Date.now();
  }, TICK_MS);
  return () => clearInterval(timer);
});

const team = $derived(
  buildAgentTeam({ agents, activities, leadTitle, viewedId, nowMs }),
);
const summary = $derived(agentsPillSummary(team, commands.length));
const leadId = $derived(team?.lead.id);
const inSubagent = $derived(Boolean(leadId && viewedId !== leadId));
const viewedRow = $derived(
  team
    ? [team.lead, ...team.visible, ...team.folded].find((r) => r.viewed)
    : undefined,
);

let showFolded = $state(false);
let outputFor = $state<string>();

const dotTone: Record<AgentRowState, StatusTone> = {
  needs_you: "warning",
  working: "info",
  waiting: "warning",
  idle: "neutral",
  failed: "destructive",
  stopped: "neutral",
};

function back(): void {
  if (leadId) onSelectAgent(leadId);
}

function choose(id: string): void {
  open = false;
  onSelectAgent(id);
}

const foldMinutes = FOLD_AFTER_MS / 60_000;
</script>

{#snippet agentRow(row: AgentTeamRow, indent: boolean)}
  <SelectRow
    selected={row.viewed}
    class={indent ? "ml-4 w-[calc(100%-1rem)]" : undefined}
    label={row.label}
    onclick={() => choose(row.id)}
  >
    {#snippet detail()}
      <span class="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <span class="truncate"
          >{row.lead ? "Lead · " : ""}{row.model} · {AGENT_STATE_LABEL[
            row.state
          ]}</span
        >
        <AgentContextPercent conversationId={row.id} />
      </span>
    {/snippet}
    {#snippet icon()}
      {#if row.lead}
        <Crown class="size-3.5 flex-none text-muted-foreground" />
      {:else}
        <StatusDot
          tone={dotTone[row.state]}
          size="sm"
          variant={row.state === "idle" || row.state === "stopped"
            ? "outline"
            : "solid"}
          pulse={row.state === "working"}
          label={AGENT_STATE_LABEL[row.state]}
        />
      {/if}
    {/snippet}
    {#snippet trailing()}
      {#if row.profile}
        <Badge variant="outline">{row.profile}</Badge>
      {/if}
      {#if !row.viewed}
        <ChevronRight class="size-3.5 flex-none text-muted-foreground" />
      {/if}
    {/snippet}
  </SelectRow>
{/snippet}

{#if summary && team}
  <div
    class="flex h-7 items-center overflow-hidden rounded-full border border-border bg-popover text-xs text-foreground shadow-sm"
    data-tour-id="agents-pill"
  >
    {#if inSubagent}
      <button
        type="button"
        class="flex h-full cursor-pointer items-center pr-1 pl-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Back to lead"
        title="Back to lead"
        onclick={back}
      >
        <ArrowLeft class="size-3.5" />
      </button>
    {/if}
    <Popover
      bind:open
      size="lg"
      side="bottom"
      align="end"
      ariaLabel="Agents"
      triggerClass="flex h-full cursor-pointer items-center gap-2 px-2.5 transition-colors hover:bg-accent"
    >
      {#snippet trigger()}
        {#if inSubagent && viewedRow}
          <span class="max-w-40 truncate font-medium">{viewedRow.label}</span>
          {#if viewedRow.profile}
            <Badge variant="outline">{viewedRow.profile}</Badge>
          {/if}
          <span class="h-3.5 w-px bg-border" aria-hidden="true"></span>
        {/if}
        {#if summary.size > 0}
          <span class="flex items-center gap-1">
            <Users class="size-3.5 text-muted-foreground" />
            <span class="tabular-nums">{summary.size}</span>
          </span>
          {#if summary.dot}
            <StatusDot
              tone={summary.dot}
              size="sm"
              pulse={summary.dot === "info"}
            />
          {/if}
          {#if !inSubagent && summary.working > 0}
            <span class="text-muted-foreground">{summary.working} working</span>
          {/if}
        {/if}
        {#if summary.commands > 0}
          {#if summary.size > 0}
            <span class="h-3.5 w-px bg-border" aria-hidden="true"></span>
          {/if}
          <span class="flex items-center gap-1">
            <Terminal class="size-3.5 text-muted-foreground" />
            <span class="tabular-nums">{summary.commands}</span>
            {#if !inSubagent}
              <span class="text-muted-foreground"
                >{summary.commands === 1 ? "command" : "commands"}</span
              >
            {/if}
          </span>
        {/if}
      {/snippet}

      <PopoverHeader
        title="Agents"
        meta={team.working > 0 ? `${team.working} working` : undefined}
      >
        {#snippet actions()}
          {#if inSubagent}
            <Button size="xs" variant="outline" onclick={back}>
              <ArrowLeft />
              Back to lead
            </Button>
          {/if}
        {/snippet}
      </PopoverHeader>
      <PopoverBody>
        {#if team.size > 0 || inSubagent}
          <div class="grid gap-0.5">
            {@render agentRow(team.lead, false)}
            {#each team.visible as row (row.id)}
              {@render agentRow(row, true)}
            {/each}
            {#if team.folded.length > 0}
              <SelectRow
                class="ml-4 w-[calc(100%-1rem)] text-muted-foreground"
                label={`${team.folded.length} earlier`}
                detail={`No activity for ${foldMinutes}+ minutes`}
                onclick={() => (showFolded = !showFolded)}
              >
                {#snippet icon()}
                  <ChevronRight
                    class={[
                      "size-3.5 flex-none transition-transform",
                      showFolded && "rotate-90",
                    ]}
                  />
                {/snippet}
              </SelectRow>
              {#if showFolded}
                {#each team.folded as row (row.id)}
                  {@render agentRow(row, true)}
                {/each}
              {/if}
            {/if}
          </div>
        {/if}

        {#if commands.length > 0}
          <PopoverSection
            label={`Background commands · ${inSubagent ? "this agent" : "this conversation"}`}
            separated={team.size > 0 || inSubagent}
          >
            {#each commands as command (command.id)}
              <div class="grid gap-1 px-1.5 py-1 text-xs">
                <div class="flex items-center gap-2">
                  <Terminal
                    class="size-3.5 flex-none text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span
                    class="min-w-0 flex-1 truncate font-mono"
                    title={command.command}>{command.command}</span
                  >
                  <span class="flex-none text-muted-foreground tabular-nums"
                    >{relativeTimeLabel(command.startedAt)}</span
                  >
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-pressed={outputFor === command.id}
                    onclick={() =>
                      (outputFor =
                        outputFor === command.id ? undefined : command.id)}
                  >
                    Output
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    class="text-destructive"
                    onclick={() => onStopCommand(command)}
                  >
                    Stop
                  </Button>
                </div>
                {#if outputFor === command.id}
                  <pre
                    class="max-h-40 overflow-auto rounded-md bg-well p-2 font-mono text-xs whitespace-pre-wrap">{commandOutput(
                      command,
                    ) ??
                      "No live output yet. Finished output is in the transcript."}</pre>
                {/if}
              </div>
            {/each}
          </PopoverSection>
        {/if}
      </PopoverBody>
    </Popover>
  </div>
{/if}
