<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import Ban from "@lucide/svelte/icons/ban";
import Check from "@lucide/svelte/icons/check";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CircleDashed from "@lucide/svelte/icons/circle-dashed";
import CircleHelp from "@lucide/svelte/icons/circle-help";
import CircleX from "@lucide/svelte/icons/circle-x";
import Clock from "@lucide/svelte/icons/clock";
import ExternalLink from "@lucide/svelte/icons/external-link";
import Users from "@lucide/svelte/icons/users";
import Terminal from "@lucide/svelte/icons/terminal";
import type { AsyncBash } from "@nervekit/contracts/core";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import { tick } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import { slide } from "svelte/transition";
import type {
  AgentActivitySnapshot,
  AgentRecord,
} from "$lib/presentation/view-models/conversation";
import type { AgentRowState } from "./agent-team";
import {
  activityDuration,
  commandFirstLine,
  COMMAND_STATE_LABEL,
  islandAgents,
  islandCommands,
  islandCount,
  type ActivityIslandSection,
} from "./activity-island";

let {
  agents,
  activities,
  viewedId,
  commands,
  open = $bindable<ActivityIslandSection>(null),
  showLatest,
  onJumpToBottom,
  onSelectAgent,
  onOpenCommand,
  active = true,
}: {
  agents: AgentRecord[];
  activities: Record<string, AgentActivitySnapshot>;
  viewedId: string;
  commands: AsyncBash[];
  open?: ActivityIslandSection;
  showLatest: boolean;
  onJumpToBottom: () => void;
  onSelectAgent: (id: string) => void;
  onOpenCommand: (command: AsyncBash) => void;
  /** Hidden workspace tabs must set false; no hidden timers or animated spinners. */
  active?: boolean;
} = $props();

const componentId = $props.id();
const team = $derived(islandAgents(agents, activities, viewedId));
const runs = $derived(islandCommands(commands));
const inSubagent = $derived(Boolean(team.leadId && team.leadId !== viewedId));
const selectedSummary = $derived(open === "agents" ? team : runs);
let root = $state<HTMLDivElement>();
let panel = $state<HTMLElement>();
let dock = $state<HTMLDivElement>();
let controls = $state<HTMLDivElement>();
let agentsTrigger = $state<HTMLButtonElement | null>(null);
let commandsTrigger = $state<HTMLButtonElement | null>(null);
let anchorSize = $state<{ width: number; height: number }>();
let nowMs = $state(Date.now());

// Reserve only the collapsed footprint. The actual dock and panel share one
// animated width and expand left/up absolutely, never moving the composer band.
$effect(() => {
  if ((open && anchorSize) || !controls || !dock) return;
  const row = controls;
  const frame = dock;
  function measure(): void {
    const rect = row.getBoundingClientRect();
    const style = getComputedStyle(frame);
    const width =
      rect.width +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.borderRightWidth);
    const height =
      rect.height +
      parseFloat(style.borderTopWidth) +
      parseFloat(style.borderBottomWidth);
    if (width !== anchorSize?.width || height !== anchorSize?.height)
      anchorSize = { width, height };
  }
  const observer = new ResizeObserver(measure);
  observer.observe(row);
  return () => observer.disconnect();
});

// Ages are createdAt -> now, never masquerading as measured execution time.
$effect(() => {
  if (!active || !open) return;
  nowMs = Date.now();
  const timer = setInterval(() => {
    nowMs = Date.now();
  }, 1000);
  return () => clearInterval(timer);
});

function collapse(restoreFocus = true): void {
  const trigger = open === "agents" ? agentsTrigger : commandsTrigger;
  open = null;
  if (restoreFocus) trigger?.focus({ preventScroll: true });
}

function outside(event: PointerEvent): void {
  if (active && open && root && !event.composedPath().includes(root))
    collapse();
}

function escape(event: KeyboardEvent): void {
  if (active && open && event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    collapse();
  }
}

function expand(node: HTMLElement) {
  const token = getComputedStyle(node).getPropertyValue(
    "--motion-enter-duration",
  );
  return slide(node, {
    duration:
      !active || prefersReducedMotion.current ? 0 : parseFloat(token) || 0,
  });
}

async function toggle(
  section: Exclude<ActivityIslandSection, null>,
  event: MouseEvent,
): Promise<void> {
  open = open === section ? null : section;
  if (open && event.detail === 0) {
    await tick();
    panel
      ?.querySelector<HTMLButtonElement>("[data-row-action]")
      ?.focus({ preventScroll: true });
  }
}

function select(id: string): void {
  collapse(false);
  onSelectAgent(id);
}

const agentStatus: Record<AgentRowState, string> = {
  working: "Running",
  needs_you: "Needs you",
  waiting: "Waiting for background work",
  failed: "Error",
  stopped: "Aborted",
  idle: "Idle",
};
</script>

<svelte:window onpointerdown={outside} onkeydown={escape} />

{#snippet agentGlyph(state: AgentRowState)}
  <span
    class="flex size-4 shrink-0 items-center justify-center"
    title={agentStatus[state]}
    class:text-info={state === "working"}
    class:text-warning={state === "needs_you" || state === "waiting"}
    class:text-destructive={state === "failed"}
    class:text-muted-foreground={state === "idle" || state === "stopped"}
  >
    <span class="sr-only">{agentStatus[state]}</span>
    {#if state === "working"}
      {#if active}<Spinner
          class="size-3.5 motion-reduce:animate-none!"
          role="presentation"
          aria-hidden="true"
        />{:else}<CircleDashed class="size-3.5" aria-hidden="true" />{/if}
    {:else if state === "needs_you"}<CircleHelp
        class="size-3.5"
        aria-hidden="true"
      />
    {:else if state === "waiting"}<Clock class="size-3.5" aria-hidden="true" />
    {:else if state === "failed"}<CircleAlert
        class="size-3.5"
        aria-hidden="true"
      />
    {:else if state === "stopped"}<Ban class="size-3.5" aria-hidden="true" />
    {:else}<Check class="size-3.5" aria-hidden="true" />{/if}
  </span>
{/snippet}

{#snippet commandGlyph(status: AsyncBash["status"])}
  <span
    class="flex size-4 shrink-0 items-center justify-center"
    title={COMMAND_STATE_LABEL[status]}
    class:text-info={status === "running"}
    class:text-success={status === "completed"}
    class:text-destructive={status === "failed"}
    class:text-warning={status === "timed_out" || status === "lost"}
    class:text-muted-foreground={status === "cancelled"}
  >
    <span class="sr-only">{COMMAND_STATE_LABEL[status]}</span>
    {#if status === "running"}
      {#if active}<Spinner
          class="size-3.5 motion-reduce:animate-none!"
          role="presentation"
          aria-hidden="true"
        />{:else}<CircleDashed class="size-3.5" aria-hidden="true" />{/if}
    {:else if status === "completed"}<Check
        class="size-3.5"
        aria-hidden="true"
      />
    {:else if status === "failed"}<CircleX
        class="size-3.5"
        aria-hidden="true"
      />
    {:else if status === "timed_out"}<Clock
        class="size-3.5"
        aria-hidden="true"
      />
    {:else if status === "cancelled"}<Ban class="size-3.5" aria-hidden="true" />
    {:else}<CircleHelp class="size-3.5" aria-hidden="true" />{/if}
  </span>
{/snippet}

{#if team.total || runs.total || inSubagent || showLatest}
  <div
    bind:this={root}
    class="relative min-w-0 max-w-(--conversation-activity-width) flex-none"
    style:width={anchorSize ? `${anchorSize.width}px` : undefined}
    style:height={anchorSize ? `${anchorSize.height}px` : undefined}
    data-tour-id="activity-island"
  >
    <div
      class={[
        anchorSize ? "absolute" : "relative",
        "right-0 bottom-0 z-20 max-w-(--conversation-activity-width) transition-[width] duration-(--motion-enter-duration) ease-(--motion-enter-easing) motion-reduce:transition-none",
      ]}
      style:width={open && anchorSize
        ? "calc(var(--spacing) * 90)"
        : anchorSize
          ? `${anchorSize.width}px`
          : "max-content"}
    >
      {#if open}
        <section
          bind:this={panel}
          id={`${componentId}-list`}
          aria-label={open === "agents" ? "Agents" : "Commands"}
          class="absolute right-0 bottom-full flex max-h-[min(calc(var(--spacing)*80),var(--conversation-activity-height,100vh))] w-full flex-col overflow-hidden rounded-t-md border border-b-0 bg-popover text-popover-foreground shadow-md"
          transition:expand
        >
          <div class="flex min-w-0 items-center gap-2 border-b px-2.5 py-1">
            <h2 class="shrink-0 text-xs font-semibold">
              {open === "agents" ? "Agents" : "Commands"}
            </h2>
            <span
              class="min-w-0 flex-1 truncate text-xs text-muted-foreground"
              title={`${selectedSummary.running} running · ${selectedSummary.total} retained`}
              >{selectedSummary.running} running · {selectedSummary.total} retained</span
            >
            <Button
              variant="ghost"
              size="icon-xs"
              title="Collapse activity"
              aria-label="Collapse activity"
              onclick={() => collapse()}
              ><ChevronDown class="size-3.5" /></Button
            >
          </div>
          <div class="min-h-0 overflow-y-auto overscroll-contain">
            {#if open === "agents"}
              {#each team.rows as row, index (row.agent.id)}
                {#if row.recent && !team.rows[index - 1]?.recent}<h3
                    class="border-t px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                  >
                    Recent
                  </h3>{/if}
                <div
                  class="flex min-w-0 items-center gap-2 border-b px-2.5 py-2 last:border-b-0"
                >
                  {@render agentGlyph(row.state)}
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-1.5">
                      <span
                        class="min-w-0 truncate text-sm font-medium"
                        title={row.name}>{row.name}</span
                      >
                      {#if row.profile}<Badge
                          variant="outline"
                          class="max-w-24 shrink truncate"
                          title={row.profile}>{row.profile}</Badge
                        >{/if}
                      <span
                        class="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
                        title="Time since this subagent was created"
                        >age {activityDuration(
                          row.agent.createdAt,
                          null,
                          nowMs,
                        )}</span
                      >
                    </div>
                    <p
                      class="mt-1 truncate text-xs text-muted-foreground"
                      title={row.agent.task}
                    >
                      {row.agent.task || "No prompt available"}
                    </p>
                  </div>
                  <Button
                    data-row-action
                    variant="ghost"
                    size="icon-xs"
                    aria-current={row.viewed ? "page" : undefined}
                    aria-label={`Open ${row.name}: ${row.agent.task || "No prompt available"}`}
                    title={`Open ${row.name}: ${row.agent.task || "No prompt available"}`}
                    onclick={() => select(row.agent.id)}
                    ><ChevronRight class="size-3.5" /></Button
                  >
                </div>
              {:else}<p class="px-2.5 py-3 text-xs text-muted-foreground">
                  No retained subagents
                </p>{/each}
            {:else}
              {#each runs.rows as command, index (command.id)}
                {#if command.status !== "running" && (index === 0 || runs.rows[index - 1]?.status === "running")}<h3
                    class="border-t px-2.5 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                  >
                    Recent
                  </h3>{/if}
                <div
                  class="flex min-w-0 items-center gap-2 border-b px-2.5 py-2 last:border-b-0"
                >
                  {@render commandGlyph(command.status)}
                  <div class="min-w-0 flex-1">
                    <p
                      class="truncate font-mono text-xs"
                      title={command.command}
                    >
                      {commandFirstLine(command.command)}
                    </p>
                    <p
                      class="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
                    >
                      <span
                        class="shrink-0 tabular-nums"
                        title="Time from command start to finish"
                        >{activityDuration(
                          command.startedAt,
                          command.status === "running"
                            ? null
                            : command.finishedAt,
                          command.status === "running" ? nowMs : undefined,
                        )}</span
                      >
                      {#if command.finishedAt}<span
                          class="truncate"
                          title={command.finishedAt}
                          >{relativeTimeLabel(command.finishedAt)}</span
                        >{/if}
                    </p>
                  </div>
                  <Button
                    data-row-action
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Open command tab: ${command.command}`}
                    title={`Open command tab: ${command.command}`}
                    onclick={() => {
                      collapse();
                      onOpenCommand(command);
                    }}><ExternalLink class="size-3.5" /></Button
                  >
                </div>
              {:else}<p class="px-2.5 py-3 text-xs text-muted-foreground">
                  No retained commands
                </p>{/each}
            {/if}
          </div>
        </section>
      {/if}
      <div
        bind:this={dock}
        class="overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-sm"
        class:rounded-t-none={Boolean(open)}
      >
        <div
          bind:this={controls}
          class={`flex max-w-(--conversation-activity-width) items-center divide-x ${open && anchorSize ? "w-full" : "w-max"}`}
          role="group"
          aria-label="Conversation activity and navigation"
        >
          {#if inSubagent && team.leadId}<Button
              variant="ghost"
              size="icon"
              class="rounded-none"
              title="Back to lead"
              aria-label="Back to lead"
              onclick={() => select(team.leadId!)}
              ><ArrowLeft class="size-4" /></Button
            >{/if}
          {#if team.total || open === "agents"}
            <Button
              bind:ref={agentsTrigger}
              variant="ghost"
              size="default"
              class={`min-w-0 rounded-none text-xs ${open && anchorSize ? "flex-1" : "shrink"}`}
              aria-expanded={open === "agents"}
              aria-controls={open === "agents"
                ? `${componentId}-list`
                : undefined}
              aria-label={`Agents: ${team.running} running, ${team.total} retained`}
              title={`Agents: ${team.running} running, ${team.total} retained`}
              onclick={(event) => toggle("agents", event)}
            >
              {#if team.running && active}<Spinner
                  class="size-3.5 motion-reduce:animate-none!"
                  aria-label="Running agents"
                />{/if}
              <Users class="size-3.5" aria-hidden="true" />
              <span class="@max-sm/conversation-activity:hidden">Agents</span>
              <span class="shrink-0 tabular-nums"
                >{islandCount(team.running, team.total)}</span
              >
            </Button>
          {/if}
          {#if runs.total || open === "commands"}
            <Button
              bind:ref={commandsTrigger}
              variant="ghost"
              size="default"
              class={`min-w-0 rounded-none text-xs ${open && anchorSize ? "flex-1" : "shrink"}`}
              aria-expanded={open === "commands"}
              aria-controls={open === "commands"
                ? `${componentId}-list`
                : undefined}
              aria-label={`Commands: ${runs.running} running, ${runs.total} retained`}
              title={`Commands: ${runs.running} running, ${runs.total} retained`}
              onclick={(event) => toggle("commands", event)}
            >
              {#if runs.running && active}<Spinner
                  class="size-3.5 motion-reduce:animate-none!"
                  aria-label="Running commands"
                />{/if}
              <Terminal class="size-3.5" aria-hidden="true" />
              <span class="@max-sm/conversation-activity:hidden">Commands</span>
              <span class="shrink-0 tabular-nums"
                >{islandCount(runs.running, runs.total)}</span
              >
            </Button>
          {/if}
          {#if showLatest}<Button
              variant="ghost"
              size="icon"
              class="rounded-none"
              title="Jump to latest"
              aria-label="Jump to latest"
              onclick={onJumpToBottom}><ArrowDown class="size-4" /></Button
            >{/if}
        </div>
      </div>
    </div>
  </div>
{/if}
