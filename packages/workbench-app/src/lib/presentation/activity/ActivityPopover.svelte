<script lang="ts">
import Bell from "@lucide/svelte/icons/bell";
import { isActivityRunning, type Activity } from "@nervekit/contracts/activity";
import Popover, {
  PopoverHeader,
  PopoverBody,
  PopoverFooter,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
let {
  activities = [],
  error,
  unseenFailure = false,
  open = false,
  onOpenChange,
  onAction,
  onClear,
}: {
  activities?: Activity[];
  error?: string;
  unseenFailure?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onAction?: (kind: "cancel" | "retry" | "dismiss", id: string) => void;
  onClear?: () => void;
} = $props();
const running = $derived(activities.filter(isActivityRunning));
const recent = $derived(
  activities.filter((entry) => !isActivityRunning(entry)),
);
let now = $state(Date.now());
$effect(() => {
  if (!running.length) return;
  const timer = setInterval(() => {
    now = Date.now();
  }, 1000);
  return () => clearInterval(timer);
});
function elapsed(entry: Activity): string {
  const seconds = Math.max(
    0,
    Math.floor(
      ((entry.finishedAt ? Date.parse(entry.finishedAt) : now) -
        Date.parse(entry.startedAt)) /
        1000,
    ),
  );
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
</script>

<Popover
  {open}
  size="lg"
  align="end"
  ariaLabel={`Activity${running.length ? `, ${running.length} running` : ""}${unseenFailure ? ", unseen failure" : ""}`}
  triggerTitle="Activity"
  {onOpenChange}
>
  {#snippet triggerChild({ props })}
    <Button
      {...props}
      variant="ghost"
      size="icon"
      class="relative"
      ariaLabel={`Activity${running.length ? `, ${running.length} running` : ""}${unseenFailure ? ", unseen failure" : ""}`}
    >
      {#if running.length}<Spinner class="size-4" />{:else}<Bell
          class="size-4"
          aria-hidden="true"
        />{/if}
      {#if running.length}<span
          class="absolute -right-1 -top-1 rounded-full bg-info px-1 text-xs text-info-foreground"
          aria-hidden="true">{running.length}</span
        >{/if}
      {#if unseenFailure}<span
          class="absolute bottom-0 right-0 size-1.5 rounded-full bg-destructive-solid"
          aria-hidden="true"
        ></span>{/if}
    </Button>
  {/snippet}
  <PopoverHeader title="Activity" meta="All projects" />
  <PopoverBody>
    {#if error}<p role="alert" class="px-2 py-2 text-xs text-destructive">
        {error}
      </p>{/if}
    {#each [{ title: "Running", entries: running }, { title: "Recent", entries: recent }] as section (section.title)}
      <h3 class="px-2 py-2 text-xs font-semibold text-muted-foreground">
        {section.title}
      </h3>
      {#if !section.entries.length}<p
          class="px-2 py-2 text-xs text-muted-foreground"
        >
          {section.title === "Running"
            ? "Nothing running"
            : "No recent activities"}
        </p>{/if}
      {#each section.entries as entry (entry.id)}
        <div class="grid gap-1 border-b px-2 py-2 last:border-b-0">
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-sm">{entry.title}</span
            ><span class="text-xs text-muted-foreground">{elapsed(entry)}</span>
          </div>
          <p class="truncate text-xs text-muted-foreground">
            {entry.scope?.projectName ??
              entry.scope?.projectId ??
              "Application"}
          </p>
          {#if entry.scope?.repositoryPath}<p
              class="truncate font-mono text-xs text-muted-foreground"
              title={entry.scope.repositoryPath}
            >
              {entry.scope.repositoryPath}
            </p>{/if}
          <p
            class={entry.status === "failed" || entry.status === "interrupted"
              ? "text-xs text-destructive"
              : entry.status === "succeeded"
                ? "text-xs text-success"
                : "text-xs text-muted-foreground"}
          >
            {isActivityRunning(entry)
              ? (entry.phase ?? entry.status)
              : entry.status}
          </p>
          {#if entry.message}<p class="text-xs text-muted-foreground">
              {entry.message}
            </p>{/if}
          {#if isActivityRunning(entry)}
            {#if entry.progress}<Progress
                value={Math.min(
                  100,
                  (entry.progress.completed / entry.progress.total) * 100,
                )}
              />{:else}<span
                class="flex items-center gap-1 text-xs text-muted-foreground"
                ><Spinner class="size-3" />In progress</span
              >{/if}
          {/if}
          {#if entry.error}
            <Collapsible.Root>
              <Collapsible.Trigger>
                {#snippet child({ props })}
                  <Button {...props} variant="ghost" size="sm"
                    >Error details</Button
                  >
                {/snippet}
              </Collapsible.Trigger>
              <Collapsible.Content>
                <p class="break-words py-1 text-xs text-destructive">
                  {entry.error.message}
                </p>
              </Collapsible.Content>
            </Collapsible.Root>
          {/if}
          <div class="flex justify-end gap-1">
            {#if entry.actions.cancel}<Button
                variant="ghost"
                size="sm"
                onclick={() => onAction?.("cancel", entry.id)}>Cancel</Button
              >{/if}
            {#if entry.actions.retry}<Button
                variant="ghost"
                size="sm"
                onclick={() => onAction?.("retry", entry.id)}>Retry</Button
              >{/if}
            {#if !isActivityRunning(entry)}<Button
                variant="ghost"
                size="sm"
                onclick={() => onAction?.("dismiss", entry.id)}>Dismiss</Button
              >{/if}
          </div>
        </div>
      {/each}
    {/each}
  </PopoverBody>
  <PopoverFooter
    ><Button
      variant="ghost"
      size="sm"
      disabled={!recent.length}
      onclick={() => onClear?.()}>Clear recent</Button
    ></PopoverFooter
  >
</Popover>
