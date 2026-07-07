<script lang="ts">
  import Box from "@lucide/svelte/icons/box";
  import FileClock from "@lucide/svelte/icons/file-clock";
  import FileCode2 from "@lucide/svelte/icons/file-code-2";
  import Layers from "@lucide/svelte/icons/layers";
  import Terminal from "@lucide/svelte/icons/terminal";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { Progress } from "@nervekit/ui/components/ui/progress";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import { PanelSection } from "@nervekit/ui/components/workbench";
  import { computeSandboxBootProgress } from "../../state/sandbox-boot-progress";
  import { activityFor } from "../../state/sandbox-manager-selectors.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import { observedStateTone } from "../../state/sandbox-status";
  import type { SandboxDiagnosticTabId, SandboxUiEvent } from "../../state/sandbox-ui-types";
  import { modelKey } from "../../utils/model-display";

  type ContextFileSummary = {
    path: string;
    included: boolean;
    bytes?: number;
  };
  type PlainRecord = Record<string, unknown>;

  let {
    record,
    onOpenDiagnosticTab,
  }: {
    record: ManagedSandboxRecord;
    onOpenDiagnosticTab?: (id: SandboxDiagnosticTabId) => void;
  } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[record.sandboxId]);
  const activity = $derived(activityFor(store, record.sandboxId));
  const progress = $derived(computeSandboxBootProgress(record, detail));
  const richState = $derived(
    detail?.selectedConversationId
      ? detail.conversationViewsById[detail.selectedConversationId]
      : Object.values(detail?.conversationViewsById ?? {})[0],
  );
  const activeRun = $derived(
    richState?.activeRun ??
      (detail?.selectedRunId ? detail.liveRuns[detail.selectedRunId] : undefined),
  );
  const controls = $derived(detail?.agentControls);
  const selectedModel = $derived(
    controls
      ? store.models.find((model) => modelKey(model) === modelKey({ provider: controls.provider, modelId: controls.model }))
      : undefined,
  );
  const runtime = $derived(store.managerStatus?.runtime);
  const status = $derived(detail?.status ?? detail?.snapshot);
  const skills = $derived(status?.skills ?? []);
  const visibleSkills = $derived(skills.filter((skill) => skill.modelVisible));
  const waits = $derived(Object.values(detail?.waitsById ?? {}));
  const pendingWaits = $derived(waits.filter((wait) => wait.status === "waiting"));
  const contextPercent = $derived(
    typeof richState?.contextUsage?.percent === "number"
      ? richState.contextUsage.percent
      : activity?.contextUsagePct,
  );
  const contextTokens = $derived(richState?.contextUsage?.tokens);
  const contextWindow = $derived(richState?.contextUsage?.contextWindow ?? selectedModel?.contextWindow);
  const contextFiles = $derived(extractLatestContextFiles(detail?.events ?? []));

  let runtimeOpen = $state(true);
  let contextOpen = $state(true);
  let configOpen = $state(false);

  const runtimeCapabilities = $derived(
    runtime
      ? [
          ["rootfs", runtime.supportsReadOnlyRootFilesystem],
          ["privileges", runtime.supportsNoNewPrivileges],
          ["pids", runtime.supportsPidsLimit],
          ["cpu", runtime.supportsCpuLimit],
          ["memory", runtime.supportsMemoryLimit],
          ["tmpfs", runtime.supportsTmpfs],
        ]
      : [],
  );

  function asRecord(value: unknown): PlainRecord {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as PlainRecord) : {};
  }

  function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  }

  function displayBytes(bytes: number | undefined): string {
    if (bytes === undefined) return "";
    if (bytes < 1024) return `${bytes} B`;
    return `${Math.round(bytes / 1024)} KiB`;
  }

  function extractLatestContextFiles(events: SandboxUiEvent[]): ContextFileSummary[] {
    for (const event of [...events].reverse()) {
      if (event.type !== "sandbox.skills.loaded") continue;
      const data = asRecord(event.data);
      const files = data.contextFiles;
      if (!Array.isArray(files)) continue;
      const summaries: ContextFileSummary[] = [];
      for (const file of files) {
        const item = asRecord(file);
        const path = stringValue(item.path);
        if (!path) continue;
        summaries.push({ path, included: item.included === true, bytes: typeof item.bytes === "number" ? item.bytes : undefined });
      }
      return summaries;
    }
    return [];
  }
</script>

<div class="flex flex-col gap-2 p-2">
  <PanelSection title="Runtime" icon={Box} bind:open={runtimeOpen}>
    <div class="flex flex-col gap-3">
      <div class="flex items-start gap-2 rounded-md border bg-background px-2 py-2">
        <StatusDot tone={observedStateTone(record.observedState)} pulse={record.observedState === "starting" || record.observedState === "reconnecting"} />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs font-medium">{progress.headline}</p>
          <p class="text-xs text-muted-foreground">{progress.completed}/{progress.total} boot steps · {status?.connected ? "connected" : "not connected"}</p>
        </div>
        {#if status?.stale}<Badge tone="warn" size="xs">stale</Badge>{/if}
      </div>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt class="text-xs text-muted-foreground">State</dt><dd class="truncate text-xs">{record.observedState} → {record.desiredState}</dd>
        <dt class="text-xs text-muted-foreground">Backend</dt><dd class="truncate font-mono text-xs">{record.backend}</dd>
        <dt class="text-xs text-muted-foreground">Image</dt><dd class="truncate font-mono text-xs" title={record.image.reference}>{record.image.reference}</dd>
        <dt class="text-xs text-muted-foreground">Started</dt><dd class="truncate font-mono text-xs">{record.startedAt ?? detail?.status?.startedAt ?? "—"}</dd>
        <dt class="text-xs text-muted-foreground">Updated</dt><dd class="truncate font-mono text-xs">{detail?.status?.updatedAt ?? record.updatedAt}</dd>
      </dl>
      {#if runtimeCapabilities.length > 0}
        <div class="flex flex-wrap gap-1">
          {#each runtimeCapabilities as [label, supported] (label)}
            <Badge tone={supported ? "good" : "neutral"} size="xs">{label}: {supported ? "yes" : "no"}</Badge>
          {/each}
        </div>
      {/if}
      <div class="flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" onclick={() => onOpenDiagnosticTab?.("logs")}><Terminal class="size-3.5" /> Logs</Button>
        <Button size="xs" variant="outline" onclick={() => onOpenDiagnosticTab?.("events")}><FileClock class="size-3.5" /> Events</Button>
      </div>
    </div>
  </PanelSection>

  <PanelSection title="Context" icon={Layers} bind:open={contextOpen}>
    <div class="flex flex-col gap-3">
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt class="text-xs text-muted-foreground">Model</dt><dd class="truncate font-mono text-xs">{controls ? `${controls.provider}/${controls.model}` : "—"}</dd>
        <dt class="text-xs text-muted-foreground">Mode</dt><dd class="truncate text-xs">{controls ? `${controls.mode} · ${controls.permissionLevel} · ${controls.thinkingLevel}` : "—"}</dd>
        <dt class="text-xs text-muted-foreground">Conversation</dt><dd class="truncate font-mono text-xs">{detail?.selectedConversationId ?? richState?.conversationId ?? "—"}</dd>
        <dt class="text-xs text-muted-foreground">Run</dt><dd class="truncate font-mono text-xs">{activeRun ? `${activeRun.runId} · ${activeRun.status}` : "—"}</dd>
        <dt class="text-xs text-muted-foreground">Review</dt><dd class="truncate text-xs">{pendingWaits.length > 0 ? `${pendingWaits.length} waiting` : "clear"}</dd>
        <dt class="text-xs text-muted-foreground">Skills</dt><dd class="truncate text-xs">{skills.length > 0 ? `${visibleSkills.length}/${skills.length} model-visible` : "not reported"}</dd>
      </dl>
      {#if typeof contextPercent === "number"}
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-2 text-xs">
            <span class="text-muted-foreground">Context window</span>
            <span class="font-mono tabular-nums">{Math.round(contextPercent)}%{contextTokens ? ` · ${contextTokens.toLocaleString()} tokens` : ""}{contextWindow ? ` / ${contextWindow.toLocaleString()}` : ""}</span>
          </div>
          <Progress value={Math.min(100, Math.max(0, contextPercent))} />
        </div>
      {/if}
      {#if contextFiles.length > 0}
        <div class="-mx-3 -mb-2.5 flex max-h-40 flex-col overflow-y-auto border-t pt-1">
          {#each contextFiles.slice(0, 6) as file (file.path)}
            <div class="flex items-center gap-2 px-3 py-1.5 text-xs">
              <Badge tone={file.included ? "good" : "neutral"} size="xs">{file.included ? "in" : "out"}</Badge>
              <span class="min-w-0 flex-1 truncate font-mono" title={file.path}>{file.path}</span>
              {#if file.bytes !== undefined}<span class="text-muted-foreground">{displayBytes(file.bytes)}</span>{/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">Context files are not reported yet.</p>
      {/if}
    </div>
  </PanelSection>

  <PanelSection title="Config & setup" icon={FileCode2} bind:open={configOpen}>
    <div class="flex flex-col gap-2">
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt class="text-xs text-muted-foreground">Config</dt><dd class="truncate font-mono text-xs">{status?.configDigest ?? record.configDigest ?? "—"}</dd>
        <dt class="text-xs text-muted-foreground">Session</dt><dd class="truncate font-mono text-xs">{detail?.latestSession?.sessionId ?? "—"}</dd>
      </dl>
      <Button size="xs" variant="outline" onclick={() => onOpenDiagnosticTab?.("config")}>Open config YAML</Button>
    </div>
  </PanelSection>
</div>
