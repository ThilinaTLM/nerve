<script lang="ts">
import Activity from "@lucide/svelte/icons/activity";
import Bot from "@lucide/svelte/icons/bot";
import Clock from "@lucide/svelte/icons/clock";
import FileCog from "@lucide/svelte/icons/file-cog";
import Gauge from "@lucide/svelte/icons/gauge";
import MessageSquarePlus from "@lucide/svelte/icons/message-square-plus";
import Play from "@lucide/svelte/icons/play";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import ScrollText from "@lucide/svelte/icons/scroll-text";
import Terminal from "@lucide/svelte/icons/terminal";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import Wrench from "@lucide/svelte/icons/wrench";
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Separator } from "@nervekit/ui-kit/components/ui/separator";
import SandboxActionMenu from "../SandboxActionMenu.svelte";
import SandboxBootProgress from "../SandboxBootProgress.svelte";
import SandboxStatStrip from "../SandboxStatStrip.svelte";
import { computeSandboxBootProgress } from "../../state/sandbox-boot-progress";
import { sandboxLifecycleView } from "../../state/sandbox-lifecycle-view";
import { activityFor } from "../../state/sandbox-manager-selectors.svelte";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";

let { record }: { record: ManagedSandboxRecord } = $props();

const store = useSandboxManagerStore();
let startupExpanded = $state<boolean | null>(null);

const detail = $derived(store.details[record.sandboxId]);
const activity = $derived(activityFor(store, record.sandboxId));
const lifecycle = $derived(sandboxLifecycleView(record, detail));
const progress = $derived(computeSandboxBootProgress(record, detail));
const snapshot = $derived(detail?.snapshot);
const runs = $derived(snapshot?.runs ?? detail?.status?.runs ?? []);
const conversations = $derived(
  snapshot?.conversations ?? detail?.status?.conversations ?? [],
);
const agents = $derived(snapshot?.agents ?? detail?.status?.agents ?? []);
const waits = $derived([
  ...Object.values(detail?.waitsById ?? {}),
  ...runs.flatMap((run) => run.waits ?? []),
]);
const pendingWaits = $derived(
  waits.filter((wait) => wait.status === "waiting").length,
);
const toolCalls = $derived([
  ...Object.values(detail?.toolCallsById ?? {}),
  ...runs.flatMap((run) => run.toolCalls ?? []),
]);
const activeRuns = $derived(
  runs.filter((run) =>
    ["queued", "running", "streaming", "waiting"].includes(run.status),
  ).length,
);
const hasRuntimeMetrics = $derived(
  Boolean(
    snapshot || detail?.status?.runs || conversations.length || agents.length,
  ),
);
const session = $derived(
  detail?.latestSession ?? detail?.status?.lastSession ?? snapshot?.lastSession,
);
const contextUsage = $derived(
  typeof activity?.contextUsagePct === "number"
    ? `${Math.round(activity.contextUsagePct)}%`
    : "—",
);
const modelActivity = $derived(
  [activity?.provider, activity?.model].filter(Boolean).join(" / ") || "—",
);
const metrics = $derived([
  {
    label: "Conversations",
    value: conversations.length,
    icon: MessageSquarePlus,
  },
  { label: "Runs", value: `${activeRuns}/${runs.length}`, icon: Activity },
  { label: "Agents", value: agents.length, icon: Bot },
  { label: "Pending waits", value: pendingWaits, icon: Clock },
  { label: "Tool calls", value: toolCalls.length, icon: Wrench },
  { label: "Context", value: contextUsage, icon: Gauge },
]);

const runtimeRows = $derived([
  { label: "Backend", value: record.backend },
  { label: "Image", value: record.image.reference, mono: true },
  { label: "Model", value: modelActivity },
  { label: "Created", value: formatDate(record.createdAt) },
  { label: "Last changed", value: formatDate(record.updatedAt) },
]);
const connectionRows = $derived([
  { label: "Session", value: session?.sessionId ?? "—", mono: true },
  { label: "Connected", value: formatDate(session?.connectedAt) },
  {
    label: "Last heartbeat",
    value: formatDate(detail?.status?.connectivity?.lastHeartbeatAt),
  },
  {
    label: "Last event",
    value: formatDate(detail?.status?.lastEventAt ?? snapshot?.lastEventAt),
  },
  { label: "Activity", value: activity?.title ?? "—" },
]);

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function refresh(): void {
  void Promise.all([store.refreshFleet(), store.loadDetail(record.sandboxId)]);
}

function openLogs(): void {
  store.openWorkspaceDiagnosticTab(record.sandboxId, "logs");
}
</script>

<div class="h-full overflow-auto bg-background p-4">
  <div class="mx-auto flex max-w-5xl flex-col gap-3">
    <section class="rounded-md border bg-card p-4">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="truncate text-base font-semibold">
              {record.name ?? record.sandboxId}
            </h2>
            <Badge tone={lifecycle.tone} size="xs">{lifecycle.label}</Badge>
          </div>
          <p class="mt-2 text-sm font-medium text-foreground">
            {lifecycle.headline}
          </p>
          <p
            class="mt-0.5 max-w-2xl text-sm leading-relaxed text-muted-foreground"
          >
            {lifecycle.description}
          </p>
          <div
            class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
          >
            <span class="font-mono">{record.sandboxId}</span>
            {#if lifecycle.since}
              <span aria-hidden="true">·</span>
              <span>Since {formatDate(lifecycle.since)}</span>
            {/if}
            {#if lifecycle.activeStage}
              <span aria-hidden="true">·</span>
              <span
                >{progress.completed}/{progress.total} startup steps complete</span
              >
            {/if}
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          {#if lifecycle.primaryAction === "new_conversation"}
            <Button
              size="sm"
              disabled={!lifecycle.canChat}
              onclick={() => store.startNewConversation(record.sandboxId)}
            >
              <MessageSquarePlus class="size-4" /> New conversation
            </Button>
          {:else if lifecycle.primaryAction === "start"}
            <Button
              size="sm"
              onclick={() => void store.startSandbox(record.sandboxId)}
            >
              <Play class="size-4" /> Start sandbox
            </Button>
          {:else if lifecycle.primaryAction === "open_logs"}
            <Button size="sm" variant="destructive" onclick={openLogs}>
              <Terminal class="size-4" /> Open logs
            </Button>
          {/if}
          <Button
            size="icon-sm"
            variant="ghost"
            ariaLabel="Refresh summary"
            onclick={refresh}
          >
            <RefreshCw class="size-4" />
          </Button>
          <SandboxActionMenu {record} compact />
        </div>
      </div>

      {#if lifecycle.issue && (lifecycle.state === "failed" || lifecycle.state === "degraded")}
        <div
          class="mt-3 flex items-start gap-2.5 rounded-md border bg-muted/30 p-3"
        >
          <TriangleAlert class="mt-0.5 size-4 flex-none text-destructive" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-sm font-medium">
                {lifecycle.issue.stage
                  ? `${lifecycle.issue.stage} startup issue`
                  : "Sandbox issue"}
              </p>
              {#if lifecycle.issue.code}
                <Badge tone="danger" size="xs">{lifecycle.issue.code}</Badge>
              {/if}
            </div>
            <p
              class="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground"
            >
              {lifecycle.issue.message}
            </p>
          </div>
          <Button size="xs" variant="outline" onclick={openLogs}
            >Open logs</Button
          >
        </div>
      {/if}
    </section>

    <SandboxBootProgress
      {record}
      variant="banner"
      expanded={startupExpanded ?? lifecycle.defaultDetailsOpen}
      onToggle={() =>
        (startupExpanded = !(startupExpanded ?? lifecycle.defaultDetailsOpen))}
    />

    {#if hasRuntimeMetrics}
      <SandboxStatStrip items={metrics} />
    {/if}

    <div class="grid gap-3 lg:grid-cols-2">
      <section class="rounded-md border bg-card p-3">
        <h3
          class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Runtime
        </h3>
        <dl class="grid gap-1.5 text-sm">
          {#each runtimeRows as row (row.label)}
            <div
              class="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3"
            >
              <dt class="text-muted-foreground">{row.label}</dt>
              <dd
                class={`truncate ${row.mono ? "font-mono" : ""} ${row.value === "—" ? "text-muted-foreground/60" : "text-foreground"}`}
                title={row.value === "—" ? undefined : String(row.value)}
              >
                {row.value}
              </dd>
            </div>
          {/each}
        </dl>
      </section>

      <section class="rounded-md border bg-card p-3">
        <h3
          class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Connection
        </h3>
        <dl class="grid gap-1.5 text-sm">
          {#each connectionRows as row (row.label)}
            <div
              class="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3"
            >
              <dt class="text-muted-foreground">{row.label}</dt>
              <dd
                class={`truncate ${row.mono ? "font-mono" : ""} ${row.value === "—" ? "text-muted-foreground/60" : "text-foreground"}`}
                title={row.value === "—" ? undefined : String(row.value)}
              >
                {row.value}
              </dd>
            </div>
          {/each}
        </dl>
      </section>
    </div>

    <section
      class="flex flex-wrap items-center gap-1 rounded-md border bg-card px-2 py-1.5"
    >
      <span
        class="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        Diagnostics
      </span>
      <Separator orientation="vertical" class="mx-0.5 h-5" />
      <Button
        size="sm"
        variant={lifecycle.state === "failed" || lifecycle.state === "starting"
          ? "outline"
          : "ghost"}
        onclick={openLogs}
      >
        <Terminal class="size-4" /> Logs
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onclick={() =>
          store.openWorkspaceDiagnosticTab(record.sandboxId, "config")}
      >
        <FileCog class="size-4" /> Config
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onclick={() =>
          store.openWorkspaceDiagnosticTab(record.sandboxId, "events")}
      >
        <ScrollText class="size-4" /> Events
      </Button>
    </section>
  </div>
</div>
