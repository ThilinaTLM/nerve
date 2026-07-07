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
  import Terminal from "@lucide/svelte/icons/terminal";
  import Wrench from "@lucide/svelte/icons/wrench";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "@nervekit/ui/components/ui/card";
  import SandboxBootProgress from "../SandboxBootProgress.svelte";
  import { computeSandboxBootProgress } from "../../state/sandbox-boot-progress";
  import { activityFor } from "../../state/sandbox-manager-selectors.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";

  let { record }: { record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
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

  function refresh(): void {
    void Promise.all([store.refreshFleet(), store.loadDetail(record.sandboxId)]);
  }
</script>

<div class="h-full overflow-auto bg-background p-4">
  <div class="mx-auto flex max-w-6xl flex-col gap-4">
    <section class="flex flex-col gap-3 rounded-md border bg-card p-4 md:flex-row md:items-start md:justify-between">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="truncate text-lg font-semibold">{record.name ?? record.sandboxId}</h2>
          <Badge tone={progress.state === "failed" ? "warn" : progress.ready ? "good" : "accent"} size="xs">
            {connectionLabel}
          </Badge>
        </div>
        <p class="mt-1 font-mono text-xs text-muted-foreground">{record.sandboxId}</p>
        <p class="mt-2 text-sm text-muted-foreground">{progress.headline}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onclick={() => store.startNewConversation(record.sandboxId)}>
          <MessageSquarePlus class="size-4" /> New conversation
        </Button>
        <Button size="sm" variant="outline" onclick={refresh}>
          <RefreshCw class="size-4" /> Refresh
        </Button>
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="text-sm font-semibold">Boot details</h3>
      <SandboxBootProgress {record} variant="banner" expanded={!progress.ready || progress.state === "failed"} />
    </section>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {#each metrics as metric (metric.label)}
        {@const Icon = metric.icon}
        <Card class="rounded-md border">
          <CardContent class="flex items-center gap-3 p-4">
            <div class="rounded-md bg-muted p-2">
              <Icon class="size-5 text-muted-foreground" />
            </div>
            <div class="min-w-0">
              <p class="text-2xl font-semibold tabular-nums">{metric.value}</p>
              <p class="text-xs text-muted-foreground">{metric.label}</p>
            </div>
          </CardContent>
        </Card>
      {/each}
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <Card class="rounded-md border">
        <CardHeader class="pb-2">
          <CardTitle class="text-sm">Runtime</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-2 text-sm">
          {#each runtimeRows as row (row.label)}
            <div class="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3">
              <span class="text-muted-foreground">{row.label}</span>
              <span class={`truncate ${row.mono ? "font-mono text-xs" : ""}`}>{row.value}</span>
            </div>
          {/each}
        </CardContent>
      </Card>

      <Card class="rounded-md border">
        <CardHeader class="pb-2">
          <CardTitle class="text-sm">Session</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-2 text-sm">
          {#each sessionRows as row (row.label)}
            <div class="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3">
              <span class="text-muted-foreground">{row.label}</span>
              <span class={`truncate ${row.mono ? "font-mono text-xs" : ""}`}>{row.value}</span>
            </div>
          {/each}
        </CardContent>
      </Card>
    </div>

    <section class="flex flex-wrap gap-2 rounded-md border bg-card p-3">
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
