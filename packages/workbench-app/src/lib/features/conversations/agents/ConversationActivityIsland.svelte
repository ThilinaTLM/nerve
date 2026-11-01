<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import Ban from "@lucide/svelte/icons/ban";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CircleDashed from "@lucide/svelte/icons/circle-dashed";
import CircleHelp from "@lucide/svelte/icons/circle-help";
import Clock from "@lucide/svelte/icons/clock";
import Users from "@lucide/svelte/icons/users";
import Terminal from "@lucide/svelte/icons/terminal";
import type { AsyncBash } from "@nervekit/contracts/core";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { tick, type Snippet } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import { cubicOut } from "svelte/easing";
import { fade, slide } from "svelte/transition";
import AsyncBashStatusIcon from "../views/AsyncBashStatusIcon.svelte";
import type {
  AgentActivitySnapshot,
  AgentRecord,
} from "$lib/presentation/view-models/conversation";
import type { AgentRowState } from "./agent-team";
import {
  commandFirstLine,
  COMMAND_STATE_LABEL,
  islandAgents,
  islandCommands,
  islandCount,
  type ActivityIslandSection,
  type IslandAgentRow,
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
let showFolded = $state(false);
const inSubagent = $derived(Boolean(team.leadId && team.leadId !== viewedId));
const selectedSummary = $derived(open === "agents" ? team : runs);
let root = $state<HTMLDivElement>();
let panel = $state<HTMLElement>();
let dock = $state<HTMLDivElement>();
let controls = $state<HTMLDivElement>();
let agentsTrigger = $state<HTMLButtonElement | null>(null);
let commandsTrigger = $state<HTMLButtonElement | null>(null);
let anchorSize = $state<{ width: number; height: number }>();

// Reserve only the collapsed footprint. The actual dock and panel share one
// animated width and expand left/up absolutely, never moving the composer band.
$effect(() => {
  if (((open || morphing) && anchorSize) || !controls || !dock) return;
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

function motionMs(node: Element, scale = 1): number {
  if (!active || prefersReducedMotion.current) return 0;
  const token = getComputedStyle(node).getPropertyValue(
    "--motion-enter-duration",
  );
  return (parseFloat(token) || 0) * scale;
}

// Choreography, mirrored on close so every motion reverses its opening path:
//   open:  dock widens leftward -> panel rises out of it (slightly delayed)
//   close: panel sinks into the dock -> dock narrows rightward (delayed)
// The panel box never resizes; a bottom-anchored clip reveals it upward.
function reveal(node: HTMLElement, { leaving = false } = {}) {
  return {
    delay: leaving ? 0 : motionMs(node, 0.35),
    duration: motionMs(node, leaving ? 0.6 : 1),
    easing: cubicOut,
    css: (t: number) =>
      `clip-path: inset(${(1 - t) * 100}% 0 0 0); opacity: ${Math.min(1, t * 1.6)}; transform: translateY(${(1 - t) * 4}px);`,
  };
}

function expandFolded(node: Element) {
  return slide(node, { duration: motionMs(node, 0.8), easing: cubicOut });
}

function edge(node: Element) {
  return slide(node, {
    axis: "x",
    duration: motionMs(node, 0.8),
    easing: cubicOut,
  });
}

// While the dock morphs between collapsed and expanded, width is animated by
// CSS. At rest it follows the measured footprint exactly (no transition), so
// buttons sliding in/out don't retarget a transition every frame. `.pre` makes
// the transition class land in the same DOM update as the new width. The morph
// ends on the width transition's own `transitionend`, so a late or slowed
// transition never outlives the full-width layout; the timer is only a
// fallback for when no transition runs (unchanged width, interruption).
let morphing = $state(false);
/** Panel still on screen (including its exit), so the dock stays attached. */
let panelShown = $state(false);
const expanded = $derived(Boolean((open || morphing) && anchorSize));
let morphTimer: ReturnType<typeof setTimeout> | undefined;
let seenOpen: ActivityIslandSection = null;
$effect.pre(() => {
  const current = open;
  if (current === seenOpen) return;
  showFolded = false;
  // Section swaps keep the dock expanded; only open/close morphs the width.
  const morph = Boolean(current) !== Boolean(seenOpen);
  seenOpen = current;
  if (!morph) return;
  morphing = true;
  armMorphFallback();
});
function armMorphFallback(): void {
  clearTimeout(morphTimer);
  const ms = dock ? motionMs(dock, 1.6) : 0;
  morphTimer = setTimeout(() => (morphing = false), ms && ms + 40);
}
function isMorph(event: TransitionEvent): boolean {
  return event.target === event.currentTarget && event.propertyName === "width";
}
// A running width transition always ends or cancels, so it owns the morph.
function morphRun(event: TransitionEvent): void {
  if (isMorph(event)) clearTimeout(morphTimer);
}
function morphEnd(event: TransitionEvent): void {
  if (!isMorph(event)) return;
  clearTimeout(morphTimer);
  morphing = false;
}
// Retargeting cancels the old transition before the new one runs.
function morphCancel(event: TransitionEvent): void {
  if (isMorph(event)) armMorphFallback();
}
$effect(() => () => clearTimeout(morphTimer));

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
    {:else}<CircleCheck class="size-3.5" aria-hidden="true" />{/if}
  </span>
{/snippet}

{#snippet agentRow(row: IslandAgentRow)}
  <Button
    data-row-action
    variant="ghost"
    class="w-full min-w-0 justify-start rounded-none text-left"
    aria-current={row.viewed ? "page" : undefined}
    aria-label={`Open ${row.name}${row.profile ? ` (${row.profile})` : ""}: ${agentStatus[row.state]}`}
    title={`Open ${row.name}`}
    onclick={() => select(row.agent.id)}
  >
    {@render agentGlyph(row.state)}
    <span class="flex min-w-0 flex-1 items-center gap-1.5">
      <span class="min-w-0 truncate text-ui">{row.name}</span>
      {#if row.profile}<Badge
          variant="neutral"
          class="max-w-24 shrink-0 truncate"
          title={row.profile}>{row.profile}</Badge
        >{/if}
    </span>
  </Button>
{/snippet}

{#snippet commandRow(command: AsyncBash)}
  <Button
    data-row-action
    variant="ghost"
    class="w-full min-w-0 justify-start rounded-none text-left"
    aria-label={`Open command tab: ${command.command} (${COMMAND_STATE_LABEL[command.status]})`}
    title={command.command}
    onclick={() => {
      collapse();
      onOpenCommand(command);
    }}
  >
    <AsyncBashStatusIcon status={command.status} animate={active} />
    <span class="min-w-0 flex-1 truncate font-mono text-ui">
      {commandFirstLine(command.command)}
    </span>
  </Button>
{/snippet}

<!-- Live rows always show; only a long tail of older settled rows folds
     behind one secondary disclosure row. -->
{#snippet list<T>(
  rows: T[],
  folded: T[],
  key: (item: T) => string,
  row: Snippet<[T]>,
  empty: string,
)}
  {#each rows as item (key(item))}{@render row(item)}{/each}
  {#if folded.length}
    <Button
      variant="ghost"
      class="w-full min-w-0 justify-start rounded-none text-left text-ui text-muted-foreground hover:text-foreground"
      aria-expanded={showFolded}
      aria-controls={`${componentId}-folded`}
      onclick={() => (showFolded = !showFolded)}
    >
      <span class="flex size-4 shrink-0 items-center justify-center">
        <ChevronRight
          class={[
            "size-3.5 transition-transform duration-(--motion-enter-compact-duration) ease-(--motion-enter-easing) motion-reduce:transition-none",
            showFolded && "rotate-90",
          ]}
          aria-hidden="true"
        />
      </span>
      <span class="min-w-0 truncate"
        >{showFolded ? "Hide" : "Show"}
        <span class="tabular-nums">{folded.length}</span> older</span
      >
    </Button>
    {#if showFolded}
      <div
        id={`${componentId}-folded`}
        class="flex flex-col divide-y"
        transition:expandFolded
      >
        {#each folded as item (key(item))}{@render row(item)}{/each}
      </div>
    {/if}
  {:else if !rows.length}
    <p class="px-2.5 py-3 text-ui text-muted-foreground">{empty}</p>
  {/if}
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
        "right-0 bottom-0 z-20 max-w-(--conversation-activity-width)",
        morphing &&
          "transition-[width] duration-(--motion-enter-duration) ease-(--motion-enter-easing) motion-reduce:transition-none",
        morphing && !open && "delay-(--motion-enter-minimal-duration)",
      ]}
      style:width={open && anchorSize
        ? "calc(var(--spacing) * 90)"
        : anchorSize
          ? `${anchorSize.width}px`
          : "max-content"}
      ontransitionrun={morphRun}
      ontransitionend={morphEnd}
      ontransitioncancel={morphCancel}
    >
      {#if open}
        <section
          bind:this={panel}
          id={`${componentId}-list`}
          aria-label={open === "agents" ? "Agents" : "Commands"}
          class="absolute right-0 bottom-full flex max-h-[min(calc(var(--spacing)*80),var(--conversation-activity-height,100vh))] w-full flex-col overflow-hidden rounded-t-md border border-b-0 bg-popover text-popover-foreground shadow-overlay will-change-[clip-path,opacity,transform]"
          in:reveal
          out:reveal={{ leaving: true }}
          onintrostart={() => (panelShown = true)}
          onoutroend={() => (panelShown = false)}
        >
          <div class="flex min-w-0 items-center gap-2 border-b px-2.5 py-1">
            <h2 class="shrink-0 text-ui font-medium">
              {open === "agents" ? "Agents" : "Commands"}
            </h2>
            <!-- The tab below already shows the total; only live work earns header space. -->
            <span class="flex min-w-0 flex-1 items-center">
              {#if selectedSummary.running}<span
                  class="flex items-center gap-1 text-ui text-info tabular-nums"
                  title={`${selectedSummary.running} running`}
                  >{#if active}<Spinner
                      class="size-3 motion-reduce:animate-none!"
                      aria-hidden="true"
                    />{:else}<CircleDashed
                      class="size-3"
                      aria-hidden="true"
                    />{/if}{selectedSummary.running}<span class="sr-only"
                    >running</span
                  ></span
                >{/if}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Collapse activity"
              aria-label="Collapse activity"
              onclick={() => collapse()}
              ><ChevronDown class="size-3.5" /></Button
            >
          </div>
          <div class="min-h-0 overflow-y-auto overscroll-contain">
            {#key open}
              <div
                class="flex flex-col divide-y"
                in:fade={{ duration: motionMs(document.body, 0.6) }}
              >
                {#if open === "agents"}
                  {@render list(
                    team.rows,
                    team.folded,
                    (row) => row.agent.id,
                    agentRow,
                    "No retained subagents",
                  )}
                {:else}
                  {@render list(
                    runs.rows,
                    runs.folded,
                    (command) => command.id,
                    commandRow,
                    "No retained commands",
                  )}
                {/if}
              </div>
            {/key}
          </div>
        </section>
      {/if}
      <div
        bind:this={dock}
        class="overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-sm transition-[border-radius] duration-(--motion-enter-compact-duration) ease-(--motion-enter-easing) motion-reduce:transition-none"
        class:rounded-t-none={Boolean(open) || panelShown}
      >
        <div
          bind:this={controls}
          class={`ml-auto flex max-w-(--conversation-activity-width) items-center divide-x ${expanded ? "w-full" : "w-max"}`}
          role="group"
          aria-label="Conversation activity and navigation"
        >
          {#if inSubagent && team.leadId}<div
              class="flex shrink-0 overflow-hidden"
              transition:edge
            >
              <Button
                variant="ghost"
                size="icon"
                class="rounded-none"
                title="Back to lead"
                aria-label="Back to lead"
                onclick={() => select(team.leadId!)}
                ><ArrowLeft class="size-4" /></Button
              >
            </div>{/if}
          {#if team.total || open === "agents"}
            <Button
              bind:ref={agentsTrigger}
              variant="ghost"
              class="min-w-0 flex-auto rounded-none text-ui"
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
              class="min-w-0 flex-auto rounded-none text-ui"
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
          {#if showLatest}<div
              class="flex shrink-0 overflow-hidden"
              transition:edge
            >
              <Button
                variant="ghost"
                size="icon"
                class="rounded-none"
                title="Jump to latest"
                aria-label="Jump to latest"
                onclick={onJumpToBottom}><ArrowDown class="size-4" /></Button
              >
            </div>{/if}
        </div>
      </div>
    </div>
  </div>
{/if}
