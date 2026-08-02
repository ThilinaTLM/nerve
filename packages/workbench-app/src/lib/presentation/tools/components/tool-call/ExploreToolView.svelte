<script lang="ts">
import FileText from "@lucide/svelte/icons/file-text";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import type { ToolDraftViewModel } from "../../../state/active-run";
import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
import {
  aggregateExploreTasks,
  type ExploreTaskState,
  type ToolView,
} from "../../views/tool-result-view";
import SubagentTranscriptDialog from "./SubagentTranscriptDialog.svelte";

type Props = {
  draft?: ToolDraftViewModel;
  toolCall?: ToolCallDisplayRecord;
  view?: Extract<ToolView, { kind: "explore" }>;
  onOpenFile?: (path: string, line?: number) => void;
};
let { draft, toolCall, view, onOpenFile }: Props = $props();

type DraftTask = {
  key: string;
  index: number;
  count: number;
  label?: string;
  task?: string;
  status: "drafting";
};
type DisplayTask = ExploreTaskState | DraftTask;

function draftTasks(): DraftTask[] {
  const args = draft?.block.args as Record<string, unknown> | undefined;
  let rawTasks = Array.isArray(args?.tasks) ? args.tasks : [];
  if (rawTasks.length === 0 && typeof args?.task === "string") {
    rawTasks = [{ task: args.task, label: args.label }];
  }
  if (rawTasks.length === 0 && draft?.block.done && draft.block.argsText) {
    try {
      const parsed = JSON.parse(draft.block.argsText) as Record<
        string,
        unknown
      >;
      rawTasks = Array.isArray(parsed.tasks)
        ? parsed.tasks
        : typeof parsed.task === "string"
          ? [{ task: parsed.task, label: parsed.label }]
          : [];
    } catch {
      // Partial JSON is expected while the model drafts arguments.
    }
  }
  const count = Math.max(1, rawTasks.length);
  return (rawTasks.length > 0 ? rawTasks : [undefined]).map((value, index) => {
    const record =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : undefined;
    return {
      key: `task-${index}`,
      index,
      count,
      label: typeof record?.label === "string" ? record.label : undefined,
      task: typeof record?.task === "string" ? record.task : undefined,
      status: "drafting" as const,
    };
  });
}

const aggregated = $derived(view ? aggregateExploreTasks(view) : undefined);
const tasks = $derived.by<DisplayTask[]>(
  () => aggregated?.tasks ?? draftTasks(),
);
const summary = $derived(aggregated?.summary);
type SelectedTranscript = {
  taskKey: string;
  parentAgentId: string;
  childAgentId: string;
  label: string;
  status: ExploreTaskState["status"];
};
let selectedTranscript = $state<SelectedTranscript>();
let transcriptOpen = $state(false);

$effect(() => {
  if (!selectedTranscript) return;
  const current = tasks.find(
    (task): task is ExploreTaskState =>
      task.key === selectedTranscript?.taskKey && task.status !== "drafting",
  );
  if (!current?.agentId) return;
  const nextLabel = taskTitle(current);
  if (
    selectedTranscript.childAgentId === current.agentId &&
    selectedTranscript.label === nextLabel &&
    selectedTranscript.status === current.status
  )
    return;
  selectedTranscript = {
    ...selectedTranscript,
    childAgentId: current.agentId,
    label: nextLabel,
    status: current.status,
  };
});

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function modelLabel(model: string): string {
  return model.split(/[/:]/).pop() ?? model;
}

function taskTitle(task: DisplayTask): string {
  return task.label ?? task.task ?? `Explore ${(task.index ?? 0) + 1}`;
}

function modelThinkingLabel(task: DisplayTask): string | undefined {
  if (!("model" in task)) return undefined;
  const parts: string[] = [];
  if (task.model) parts.push(modelLabel(task.model));
  if (task.thinkingLevel) parts.push(task.thinkingLevel);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function pluralCount(value: number, noun: string): string {
  return `${value.toLocaleString()} ${noun}${value === 1 ? "" : "s"}`;
}

function usageChips(task: ExploreTaskState): string[] {
  const usage = task.report?.usage;
  if (!usage) return [];
  const chips: string[] = [];
  if (usage.turns) chips.push(pluralCount(usage.turns, "turn"));
  const tokens = usage.totalTokens || usage.input + usage.output;
  if (tokens > 0) chips.push(pluralCount(tokens, "token"));
  return chips;
}

function statusLabel(task: DisplayTask): string {
  switch (task.status) {
    case "drafting":
      return "Drafting";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "aborted":
      return "Stopped";
  }
}

function statusTextClass(task: DisplayTask): string {
  switch (task.status) {
    case "running":
      return "text-info";
    case "completed":
      return "text-success";
    case "failed":
      return "text-destructive";
    case "aborted":
      return "text-warning";
    default:
      return "text-muted-foreground";
  }
}

function activityText(task: ExploreTaskState): string {
  if (task.status === "queued") return "Waiting for an active-agent slot…";
  if (task.status === "running")
    return task.currentAction ?? "Waiting for the first tool…";
  if (task.status === "aborted") return task.error ?? "Agent run stopped.";
  if (task.status === "failed") return task.error ?? "Agent run failed.";
  return task.report?.summaryPreview ?? "Investigation complete.";
}

function openTranscript(task: ExploreTaskState) {
  if (!task.agentId || !toolCall?.agentId) return;
  selectedTranscript = {
    taskKey: task.key,
    parentAgentId: toolCall.agentId,
    childAgentId: task.agentId,
    label: taskTitle(task),
    status: task.status,
  };
  transcriptOpen = true;
}

const aggregateLabel = $derived.by(() => {
  if (!summary) return "Preparing explore agents";
  const finished = summary.completed + summary.failed + summary.aborted;
  const extras = [
    summary.failed > 0 ? `${summary.failed} failed` : undefined,
    summary.aborted > 0 ? `${summary.aborted} stopped` : undefined,
  ].filter(Boolean);
  return `${finished} of ${summary.total} finished${extras.length ? ` · ${extras.join(" · ")}` : ""}`;
});
</script>

<div class="grid gap-2">
  <p class="sr-only" aria-live="polite">{aggregateLabel}</p>
  <ol class="grid gap-2">
    {#each tasks as task (task.key)}
      {@const modelThinking = modelThinkingLabel(task)}
      <li
        class="grid min-w-0 gap-2 rounded-lg border bg-card px-3 py-2.5"
        data-status={task.status}
      >
        <div class="flex min-w-0 items-center gap-2">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            {#if task.status === "drafting" && !task.label && !task.task}
              <Skeleton class="h-4 w-2/5" />
            {:else}
              <strong class="min-w-0 truncate text-sm font-medium leading-tight"
                >{taskTitle(task)}</strong
              >
            {/if}
            {#if modelThinking}
              <span
                class="shrink-0 rounded border px-1.5 py-0.5 text-xs leading-none text-muted-foreground"
                >{modelThinking}</span
              >
            {/if}
          </div>
          <span class={`shrink-0 text-xs font-medium ${statusTextClass(task)}`}
            >{statusLabel(task)}</span
          >
          {#if (task.count ?? 0) > 1}
            <span class="shrink-0 text-xs tabular-nums text-muted-foreground"
              >{(task.index ?? 0) + 1}/{task.count}</span
            >
          {/if}
        </div>

        {#if task.status === "drafting"}
          <div class="grid gap-1" aria-hidden="true">
            <Skeleton class="h-3 w-full" />
            <Skeleton class="h-3 w-2/3" />
          </div>
        {:else}
          <div class="flex min-w-0 items-center gap-2">
            <p
              class="m-0 min-w-0 flex-1 truncate text-xs text-muted-foreground"
            >
              {activityText(task)}
            </p>
            {#if task.status === "running" && task.actionCount > 0}
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground"
                >{pluralCount(task.actionCount, "action")}</span
              >
            {/if}
          </div>

          <div class="flex min-w-0 flex-wrap items-center gap-1.5">
            {#if task.agentId && toolCall?.agentId}
              <Button
                size="xs"
                variant="outline"
                class="h-6 gap-1 px-1.5 text-xs shadow-none"
                onclick={() => openTranscript(task)}
                aria-label={`View transcript for ${taskTitle(task)}`}
              >
                <MessagesSquare class="size-3" aria-hidden="true" />
                Transcript
              </Button>
            {/if}
            {#if task.report?.reportPath}
              <Button
                size="xs"
                variant="outline"
                class="h-6 gap-1 px-1.5 text-xs shadow-none"
                onclick={() =>
                  task.report?.reportPath &&
                  onOpenFile?.(task.report.reportPath)}
                title={task.report.reportPath}
                aria-label={`Open report ${basename(task.report.reportPath)}`}
              >
                <FileText class="size-3" aria-hidden="true" />
                Report
              </Button>
            {/if}
            {#each usageChips(task) as chip (chip)}
              <span
                class="inline-flex min-h-5 items-center rounded border bg-muted/30 px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground"
                >{chip}</span
              >
            {/each}
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</div>

{#if selectedTranscript}
  <SubagentTranscriptDialog
    bind:open={transcriptOpen}
    parentAgentId={selectedTranscript.parentAgentId}
    childAgentId={selectedTranscript.childAgentId}
    label={selectedTranscript.label}
    onOpenChange={(open) => (transcriptOpen = open)}
  />
{/if}
