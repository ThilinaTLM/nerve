<script lang="ts">
  import {
    Box,
    FileClock,
    FileCode2,
    GitBranch,
    Layers,
    PanelRightClose,
    Terminal,
  } from "@lucide/svelte";
  import type { ManagedSandboxRecord, StartupSetupStatus } from "@nervekit/shared";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { Progress } from "@nervekit/ui/components/ui/progress";
  import { ScrollArea } from "@nervekit/ui/components/ui/scroll-area";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import { computeSandboxBootProgress } from "../../state/sandbox-boot-progress";
  import { activityFor } from "../../state/sandbox-manager-selectors.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import { observedStateTone } from "../../state/sandbox-status";
  import type { SandboxDiagnosticTabId, SandboxUiEvent } from "../../state/sandbox-ui-types";
  import { modelKey } from "../../utils/model-display";
  import PanelSection from "./PanelSection.svelte";

  type PlainRecord = Record<string, unknown>;
  type ContextFileSummary = {
    path: string;
    included: boolean;
    bytes?: number;
    digest?: string;
  };

  let {
    record,
    onClose,
    onOpenDiagnosticTab,
  }: {
    record: ManagedSandboxRecord;
    onClose: () => void;
    onOpenDiagnosticTab: (id: SandboxDiagnosticTabId) => void;
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
      ? store.models.find((model) => modelKey(model) === modelKey({
          provider: controls.provider,
          modelId: controls.model,
        }))
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
  const contextWindow = $derived(
    richState?.contextUsage?.contextWindow ?? selectedModel?.contextWindow,
  );
  const contextFiles = $derived(extractLatestContextFiles(detail?.events ?? []));
  const config = $derived(asRecord(status?.config));
  const gitConfig = $derived(asRecord(config.git));
  const githubConfig = $derived(asRecord(config.github));
  const gitIdentity = $derived(asRecord(gitConfig.identity));
  const gitClone = $derived(asRecord(gitConfig.clone));
  const gitRemotes = $derived(arrayOfRecords(gitConfig.remotes));
  const credentials = $derived(status?.credentials ?? []);
  const gitCredentials = $derived(
    credentials.filter((credential) => {
      const haystack = [
        credential.provider,
        credential.group,
        credential.credentialType,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes("git") || haystack.includes("github");
    }),
  );

  let runtimeOpen = $state(true);
  let contextOpen = $state(true);
  let gitOpen = $state(true);

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
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as PlainRecord)
      : {};
  }

  function arrayOfRecords(value: unknown): PlainRecord[] {
    return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
  }

  function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0
      ? value
      : undefined;
  }

  function booleanLabel(value: unknown): string {
    if (typeof value !== "boolean") return "—";
    return value ? "yes" : "no";
  }

  function setupTone(status_: StartupSetupStatus | undefined): "good" | "warn" | "danger" | "running" | "neutral" {
    if (!status_) return "neutral";
    if (status_.status === "completed") return "good";
    if (status_.status === "failed") return "danger";
    if (status_.status === "started") return "running";
    if (status_.status === "degraded") return "warn";
    return "neutral";
  }

  function formatSetup(status_: StartupSetupStatus | undefined): string {
    if (!status_) return "not reported";
    return status_.configured ? status_.status : `not configured · ${status_.status}`;
  }

  function shortDigest(value: unknown): string | undefined {
    const text = stringValue(value);
    if (!text) return undefined;
    return text.length > 18 ? `${text.slice(0, 18)}…` : text;
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
        const summary: ContextFileSummary = {
          path,
          included: item.included === true,
        };
        if (typeof item.bytes === "number") summary.bytes = item.bytes;
        const digest = stringValue(item.digest);
        if (digest) summary.digest = digest;
        summaries.push(summary);
      }
      return summaries;
    }
    return [];
  }

  function openDiagnostic(id: SandboxDiagnosticTabId): void {
    onOpenDiagnosticTab(id);
  }
</script>

<div class="flex h-full min-w-0 flex-col bg-background">
  <div class="flex flex-none items-center gap-2 border-b px-3 py-2">
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold">Inspector</p>
      <p class="truncate font-mono text-xs text-muted-foreground">
        {record.name ?? record.sandboxId}
      </p>
    </div>
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Close inspector"
      title="Close inspector"
      onclick={onClose}
    >
      <PanelRightClose class="size-4" />
    </Button>
  </div>

  <ScrollArea class="min-h-0 flex-1">
    <div class="flex flex-col gap-2 p-2">
      <PanelSection title="Runtime" icon={Box} bind:open={runtimeOpen}>
        <div class="flex flex-col gap-3">
          <div class="flex items-start gap-2 rounded-md border bg-background px-2 py-2">
            <StatusDot
              tone={observedStateTone(record.observedState)}
              pulse={record.observedState === "starting" || record.observedState === "reconnecting"}
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-medium">{progress.headline}</p>
              <p class="text-xs text-muted-foreground">
                {progress.completed}/{progress.total} boot steps · {status?.connected ? "connected" : "not connected"}
              </p>
            </div>
            {#if status?.stale}
              <Badge tone="warn" size="xs">stale</Badge>
            {/if}
          </div>

          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <dt class="text-xs text-muted-foreground">State</dt>
            <dd class="truncate text-xs">{record.observedState} → {record.desiredState}</dd>
            <dt class="text-xs text-muted-foreground">Backend</dt>
            <dd class="truncate font-mono text-xs">{record.backend}</dd>
            <dt class="text-xs text-muted-foreground">Image</dt>
            <dd class="truncate font-mono text-xs" title={record.image.reference}>{record.image.reference}</dd>
            <dt class="text-xs text-muted-foreground">Container</dt>
            <dd class="truncate font-mono text-xs" title={record.containerRef?.id}>
              {record.containerRef ? `${record.containerRef.kind}: ${record.containerRef.name ?? record.containerRef.id}` : "—"}
            </dd>
            <dt class="text-xs text-muted-foreground">Started</dt>
            <dd class="truncate font-mono text-xs">{record.startedAt ?? detail?.status?.startedAt ?? "—"}</dd>
            <dt class="text-xs text-muted-foreground">Updated</dt>
            <dd class="truncate font-mono text-xs">{detail?.status?.updatedAt ?? record.updatedAt}</dd>
          </dl>

          {#if runtimeCapabilities.length > 0}
            <div class="flex flex-wrap gap-1">
              {#each runtimeCapabilities as [label, supported] (label)}
                <Badge tone={supported ? "good" : "neutral"} size="xs">
                  {label}: {supported ? "yes" : "no"}
                </Badge>
              {/each}
            </div>
          {/if}

          <div class="flex flex-wrap gap-1.5">
            <Button size="xs" variant="outline" onclick={() => openDiagnostic("logs")}>
              <Terminal class="size-3.5" /> Logs
            </Button>
            <Button size="xs" variant="outline" onclick={() => openDiagnostic("events")}>
              <FileClock class="size-3.5" /> Events
            </Button>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Context" icon={Layers} bind:open={contextOpen}>
        <div class="flex flex-col gap-3">
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <dt class="text-xs text-muted-foreground">Model</dt>
            <dd class="truncate font-mono text-xs" title={controls ? `${controls.provider}/${controls.model}` : undefined}>
              {controls ? `${controls.provider}/${controls.model}` : "—"}
            </dd>
            <dt class="text-xs text-muted-foreground">Mode</dt>
            <dd class="truncate text-xs">
              {controls ? `${controls.mode} · ${controls.permissionLevel} · ${controls.thinkingLevel}` : "—"}
            </dd>
            <dt class="text-xs text-muted-foreground">Conversation</dt>
            <dd class="truncate font-mono text-xs">{detail?.selectedConversationId ?? richState?.conversationId ?? "—"}</dd>
            <dt class="text-xs text-muted-foreground">Run</dt>
            <dd class="truncate font-mono text-xs">
              {activeRun ? `${activeRun.runId} · ${activeRun.status}` : "—"}
            </dd>
            <dt class="text-xs text-muted-foreground">Review</dt>
            <dd class="truncate text-xs">
              {pendingWaits.length > 0 ? `${pendingWaits.length} waiting` : "clear"}
            </dd>
            <dt class="text-xs text-muted-foreground">Skills</dt>
            <dd class="truncate text-xs">
              {skills.length > 0 ? `${visibleSkills.length}/${skills.length} model-visible` : "not reported"}
            </dd>
          </dl>

          {#if typeof contextPercent === "number"}
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center justify-between gap-2 text-xs">
                <span class="text-muted-foreground">Context window</span>
                <span class="font-mono tabular-nums">
                  {Math.round(contextPercent)}%{contextTokens ? ` · ${contextTokens.toLocaleString()} tokens` : ""}{contextWindow ? ` / ${contextWindow.toLocaleString()}` : ""}
                </span>
              </div>
              <Progress value={Math.min(100, Math.max(0, contextPercent))} />
            </div>
          {/if}

          {#if contextFiles.length > 0}
            <div class="-mx-3 -mb-2.5 flex max-h-40 flex-col overflow-y-auto border-t pt-1">
              {#each contextFiles.slice(0, 6) as file (file.path)}
                <div class="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <Badge tone={file.included ? "good" : "neutral"} size="xs">
                    {file.included ? "in" : "out"}
                  </Badge>
                  <span class="min-w-0 flex-1 truncate font-mono" title={file.path}>{file.path}</span>
                  {#if file.bytes !== undefined}
                    <span class="text-muted-foreground">{displayBytes(file.bytes)}</span>
                  {/if}
                </div>
              {/each}
              {#if contextFiles.length > 6}
                <p class="px-3 py-1.5 text-xs text-muted-foreground">+{contextFiles.length - 6} more context files</p>
              {/if}
            </div>
          {:else}
            <p class="rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
              Context files are not reported yet. Loaded skills and token usage will appear as the agent runs.
            </p>
          {/if}
        </div>
      </PanelSection>

      <PanelSection title="Git" icon={GitBranch} bind:open={gitOpen}>
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap gap-1.5">
            <Badge tone={setupTone(status?.setup?.git)} size="xs">
              git: {formatSetup(status?.setup?.git)}
            </Badge>
            <Badge tone={setupTone(status?.setup?.github)} size="xs">
              github: {formatSetup(status?.setup?.github)}
            </Badge>
          </div>

          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <dt class="text-xs text-muted-foreground">Author</dt>
            <dd class="truncate text-xs" title={[stringValue(gitIdentity.name), stringValue(gitIdentity.email)].filter(Boolean).join(" <") || undefined}>
              {stringValue(gitIdentity.name) ?? "—"}{#if stringValue(gitIdentity.email)} <span class="text-muted-foreground">{stringValue(gitIdentity.email)}</span>{/if}
            </dd>
            <dt class="text-xs text-muted-foreground">Clone</dt>
            <dd class="truncate font-mono text-xs" title={stringValue(gitClone.url)}>
              {stringValue(gitClone.url) ?? "—"}
            </dd>
            <dt class="text-xs text-muted-foreground">Ref</dt>
            <dd class="truncate font-mono text-xs">{stringValue(gitClone.ref) ?? stringValue(gitConfig.defaultBranch) ?? "—"}</dd>
            <dt class="text-xs text-muted-foreground">Target</dt>
            <dd class="truncate font-mono text-xs">{stringValue(gitClone.targetDir) ?? "/workspace"}</dd>
            <dt class="text-xs text-muted-foreground">Remotes</dt>
            <dd class="truncate text-xs">
              {gitRemotes.length > 0 ? gitRemotes.map((remote) => stringValue(remote.name) ?? "remote").join(", ") : "—"}
            </dd>
            <dt class="text-xs text-muted-foreground">GitHub</dt>
            <dd class="truncate text-xs">
              {stringValue(githubConfig.host) ?? "github.com"} · enabled {booleanLabel(githubConfig.enabled)}
            </dd>
            <dt class="text-xs text-muted-foreground">LFS</dt>
            <dd class="truncate text-xs">{booleanLabel(gitConfig.lfs)}</dd>
            <dt class="text-xs text-muted-foreground">Config</dt>
            <dd class="truncate font-mono text-xs">{shortDigest(status?.configDigest ?? record.configDigest) ?? "—"}</dd>
          </dl>

          {#if gitCredentials.length > 0}
            <div class="flex flex-col gap-1 rounded-md border bg-background px-2 py-1.5">
              {#each gitCredentials.slice(0, 4) as credential (`${credential.provider}:${credential.credentialType}:${credential.group ?? ""}`)}
                <div class="flex items-center justify-between gap-2 text-xs">
                  <span class="min-w-0 truncate">
                    {credential.provider}<span class="text-muted-foreground"> · {credential.credentialType}</span>
                  </span>
                  <Badge tone={credential.status === "available" ? "good" : "warn"} size="xs">
                    {credential.status}
                  </Badge>
                </div>
              {/each}
            </div>
          {/if}

          {#if status?.setup?.git?.error || status?.setup?.github?.error}
            <p class="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              {status.setup.git?.error?.message ?? status.setup.github?.error?.message}
            </p>
          {/if}

          <div class="flex flex-wrap gap-1.5">
            <Button size="xs" variant="outline" onclick={() => openDiagnostic("config")}>
              <FileCode2 class="size-3.5" /> Config YAML
            </Button>
          </div>
        </div>
      </PanelSection>
    </div>
  </ScrollArea>
</div>
