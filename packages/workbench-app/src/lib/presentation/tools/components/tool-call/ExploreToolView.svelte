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
import ToolStatusIcon from "./ToolStatusIcon.svelte";
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
let selectedTaskKey = $state<string>();
const selectedTask = $derived(
  tasks.find(
    (task): task is ExploreTaskState =>
      task.key === selectedTaskKey && task.status !== "drafting",
  ),
);
let transcriptOpen = $state(false);

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

function statusTone(task: DisplayTask) {
  switch (task.status) {
    case "running":
      return "running" as const;
    case "completed":
      return "good" as const;
    case "failed":
      return "danger" as const;
    case "aborted":
      return "warn" as const;
    default:
      return "neutral" as const;
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
  selectedTaskKey = task.key;
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
          <ToolStatusIcon
            tone={statusTone(task)}
            pulse={task.status === "running"}
            label={statusLabel(task)}
          />
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
          <span class="shrink-0 text-xs font-medium text-muted-foreground"
            >{statusLabel(task)}</span
          >
          {#if (task.count ?? 0) > 1}
            <span class="shrink-0 text-xs tabular-nums text-muted-foreground"
              >{(task.index ?? 0) + 1}/{task.count}</span
            >
          {/if}
        </div>

        {#if task.status === "drafting"}
          <div class="grid gap-1 pl-6" aria-hidden="true">
            <Skeleton class="h-3 w-full" />
            <Skeleton class="h-3 w-2/3" />
          </div>
        {:else}
          <div class="flex min-w-0 items-center gap-2 pl-6">
            <p
              class="m-0 min-w-0 flex-1 truncate text-xs text-muted-foreground"
              class:font-mono={task.status === "running" &&
                task.currentActionMono}
            >
              {activityText(task)}
            </p>
            {#if task.status === "running" && task.actionCount > 0}
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground"
                >{pluralCount(task.actionCount, "action")}</span
              >
            {/if}
          </div>

          <div class="flex min-w-0 flex-wrap items-center gap-1.5 pl-6">
            {#each usageChips(task) as chip (chip)}
              <span
                class="inline-flex min-h-5 items-center rounded border bg-muted/30 px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground"
                >{chip}</span
              >
            {/each}
            {#if task.agentId && toolCall?.agentId}
              <Button
                size="xs"
                variant="ghost"
                class="h-6 gap-1 px-1.5 text-xs"
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
                variant="ghost"
                class="h-6 gap-1 px-1.5 text-xs"
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
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</div>

{#if selectedTask && toolCall?.agentId}
  <SubagentTranscriptDialog
    bind:open={transcriptOpen}
    parentAgentId={toolCall.agentId}
    childAgentId={selectedTask.agentId}
    label={taskTitle(selectedTask)}
    revision={`${selectedTask.status}:${selectedTask.actionCount}:${selectedTask.report?.summaryPreview ?? ""}`}
    running={selectedTask.status === "running"}
    onOpenChange={(open) => (transcriptOpen = open)}
  />
{/if}
