<script lang="ts">
  import Activity from "@lucide/svelte/icons/activity";
  import Bot from "@lucide/svelte/icons/bot";
  import Clock from "@lucide/svelte/icons/clock";
  import FileCog from "@lucide/svelte/icons/file-cog";
  import FileText from "@lucide/svelte/icons/file-text";
  import Gauge from "@lucide/svelte/icons/gauge";
  import MessageSquarePlus from "@lucide/svelte/icons/message-square-plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Square from "@lucide/svelte/icons/square";
  import Terminal from "@lucide/svelte/icons/terminal";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Wrench from "@lucide/svelte/icons/wrench";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import SandboxBootProgress from "../SandboxBootProgress.svelte";
  import SandboxStatStrip from "../SandboxStatStrip.svelte";
  import SandboxRemoveDialog from "../SandboxRemoveDialog.svelte";
  import { computeSandboxBootProgress } from "../../state/sandbox-boot-progress";
  import { activityFor } from "../../state/sandbox-manager-selectors.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import { canRestart, canStop } from "../../state/sandbox-status";

  let { record }: { record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
  let removeOpen = $state(false);

  const detail = $derived(store.details[record.sandboxId]);
  const activity = $derived(activityFor(store, record.sandboxId));
  const progress = $derived(computeSandboxBootProgress(record, detail));
  const snapshot = $derived(detail?.snapshot);
  const runs = $derived(snapshot?.runs ?? detail?.status?.runs ?? []);
  const conversations = $derived(snapshot?.conversations ?? detail?.status?.conversations ?? []);
  const agents = $derived(snapshot?.agents ?? detail?.status?.agents ?? []);
  const waits = $derived([
    ...Object.values(detail?.waitsById ?? {}),
    ...runs.flatMap((run) => run.waits ?? []),
  ]);
  const pendingWaits = $derived(waits.filter((wait) => wait.status === "waiting").length);
  const toolCalls = $derived([
    ...Object.values(detail?.toolCallsById ?? {}),
    ...runs.flatMap((run) => run.toolCalls ?? []),
  ]);
  const activeRuns = $derived(
    runs.filter((run) =>
      ["queued", "running", "streaming", "waiting"].includes(run.status),
    ).length,
  );
  const connectionLabel = $derived(
    detail?.status?.connected || detail?.controllerConnected
      ? "connected"
      : detail?.status?.status ?? record.observedState,
  );
  const session = $derived(detail?.latestSession ?? detail?.status?.lastSession ?? snapshot?.lastSession);
  const contextUsage = $derived(
    typeof activity?.contextUsagePct === "number"
      ? `${Math.round(activity.contextUsagePct)}%`
      : "—",
  );
  const modelActivity = $derived(
    [activity?.provider, activity?.model].filter(Boolean).join(" / ") || "—",
  );

  const metrics = $derived([
    { label: "Conversations", value: conversations.length, icon: MessageSquarePlus },
    { label: "Runs", value: `${activeRuns}/${runs.length}`, icon: Activity },
    { label: "Agents", value: agents.length, icon: Bot },
    { label: "Pending waits", value: pendingWaits, icon: Clock },
    { label: "Tool calls", value: toolCalls.length, icon: Wrench },
    { label: "Context", value: contextUsage, icon: Gauge },
  ]);

  function formatDate(value: string | undefined): string {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  const runtimeRows = $derived([
    { label: "Backend", value: record.backend },
    { label: "Image", value: record.image.reference, mono: true },
    { label: "Model", value: modelActivity },
    { label: "Created", value: formatDate(record.createdAt) },
    { label: "Updated", value: formatDate(record.updatedAt) },
  ]);
  const sessionRows = $derived([
    { label: "Controller", value: connectionLabel },
    { label: "Session", value: session?.sessionId ?? "—", mono: true },
    { label: "Connected", value: formatDate(session?.connectedAt) },
    { label: "Last event", value: formatDate(detail?.status?.lastEventAt ?? snapshot?.lastEventAt) },
    { label: "Activity", value: activity?.title ?? "—" },
  ]);

  function guard(action: Promise<void>): void {
    action.catch(() => undefined);
  }

  function refresh(): void {
    void Promise.all([store.refreshFleet(), store.loadDetail(record.sandboxId)]);
  }
</script>

<div class="h-full overflow-auto bg-background p-4">
  <div class="mx-auto flex max-w-5xl flex-col gap-3">
    <section class="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-card px-3 py-2.5">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="truncate text-sm font-semibold">{record.name ?? record.sandboxId}</h2>
          <Badge tone={progress.state === "failed" ? "warn" : progress.ready ? "good" : "accent"} size="xs">
            {connectionLabel}
          </Badge>
        </div>
        <div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span class="truncate font-mono">{record.sandboxId}</span>
          <span aria-hidden="true">·</span>
          <span class="truncate">{progress.headline}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onclick={() => store.startNewConversation(record.sandboxId)}>
          <MessageSquarePlus class="size-4" /> New conversation
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canStop(record)}
          onclick={() => guard(store.stopSandbox(record.sandboxId))}
        >
          <Square class="size-4" /> Stop
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canRestart(record)}
          onclick={() => guard(store.restartSandbox(record.sandboxId))}
        >
          <RefreshCw class="size-4" /> Restart
        </Button>
        <Button size="sm" variant="outline" onclick={refresh}>
          <RefreshCw class="size-4" /> Refresh
        </Button>
        <Button size="sm" variant="destructive" onclick={() => (removeOpen = true)}>
          <Trash2 class="size-4" /> Delete
        </Button>
      </div>
    </section>

    <SandboxStatStrip items={metrics} />

    <SandboxBootProgress {record} variant="banner" expanded={!progress.ready || progress.state === "failed"} />

    <div class="grid gap-3 lg:grid-cols-2">
      <div class="rounded-md border bg-card p-3">
        <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Runtime</h3>
        <dl class="grid gap-1.5 text-sm">
          {#each runtimeRows as row (row.label)}
            <div class="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
              <dt class="text-muted-foreground">{row.label}</dt>
              <dd class={`truncate ${row.mono ? "font-mono text-xs" : ""}`}>{row.value}</dd>
            </div>
          {/each}
        </dl>
      </div>

      <div class="rounded-md border bg-card p-3">
        <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Session</h3>
        <dl class="grid gap-1.5 text-sm">
          {#each sessionRows as row (row.label)}
            <div class="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
              <dt class="text-muted-foreground">{row.label}</dt>
              <dd class={`truncate ${row.mono ? "font-mono text-xs" : ""}`}>{row.value}</dd>
            </div>
          {/each}
        </dl>
      </div>
    </div>

    <section class="flex flex-wrap gap-1 rounded-md border bg-card px-2 py-1.5">
      <Button size="sm" variant="ghost" onclick={() => store.openWorkspaceDiagnosticTab(record.sandboxId, "logs")}>
        <Terminal class="size-4" /> Open logs
      </Button>
      <Button size="sm" variant="ghost" onclick={() => store.openWorkspaceDiagnosticTab(record.sandboxId, "config")}>
        <FileCog class="size-4" /> Open config
      </Button>
      <Button size="sm" variant="ghost" onclick={() => store.openWorkspaceDiagnosticTab(record.sandboxId, "events")}>
        <ScrollText class="size-4" /> Open events
      </Button>
      <Button size="sm" variant="ghost" onclick={() => store.loadLogs(record.sandboxId)}>
        <FileText class="size-4" /> Refresh logs
      </Button>
    </section>
  </div>
</div>

<SandboxRemoveDialog bind:open={removeOpen} {record} />
