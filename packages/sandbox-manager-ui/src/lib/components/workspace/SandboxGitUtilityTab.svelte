<script lang="ts">
  import FilePen from "@lucide/svelte/icons/file-pen";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import Settings from "@lucide/svelte/icons/settings";
  import type { ManagedSandboxRecord, StartupSetupStatus } from "@nervekit/shared";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { PanelSection } from "@nervekit/ui/components/workbench";
  import type { SandboxDetailState, SandboxDiagnosticTabId } from "../../state/sandbox-ui-types";

  type PlainRecord = Record<string, unknown>;

  let {
    record,
    detail,
    onOpenDiagnosticTab,
  }: {
    record: ManagedSandboxRecord;
    detail?: SandboxDetailState;
    onOpenDiagnosticTab?: (id: SandboxDiagnosticTabId) => void;
  } = $props();

  let repoOpen = $state(true);
  let changesOpen = $state(true);
  let setupOpen = $state(true);

  const status = $derived(detail?.status ?? detail?.snapshot);
  const config = $derived(asRecord(status?.config));
  const gitConfig = $derived(asRecord(config.git));
  const githubConfig = $derived(asRecord(config.github));
  const gitIdentity = $derived(asRecord(gitConfig.identity));
  const gitClone = $derived(asRecord(gitConfig.clone));
  const gitRemotes = $derived(arrayOfRecords(gitConfig.remotes));

  function asRecord(value: unknown): PlainRecord {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as PlainRecord)
      : {};
  }

  function arrayOfRecords(value: unknown): PlainRecord[] {
    return Array.isArray(value)
      ? value.map(asRecord).filter((item) => Object.keys(item).length > 0)
      : [];
  }

  function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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
</script>

<div class="flex flex-col gap-2 p-2">
  <PanelSection title="Repo & Branch" icon={GitBranch} bind:open={repoOpen}>
    <div class="flex flex-col gap-3">
      <p class="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground">
        Working-tree status is not available until sandbox Git status reporting is added.
      </p>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt class="text-xs text-muted-foreground">Clone</dt>
        <dd class="truncate font-mono text-xs" title={stringValue(gitClone.url)}>{stringValue(gitClone.url) ?? "—"}</dd>
        <dt class="text-xs text-muted-foreground">Ref</dt>
        <dd class="truncate font-mono text-xs">{stringValue(gitClone.ref) ?? stringValue(gitConfig.defaultBranch) ?? "—"}</dd>
        <dt class="text-xs text-muted-foreground">Target</dt>
        <dd class="truncate font-mono text-xs">{stringValue(gitClone.targetDir) ?? "/workspace"}</dd>
        <dt class="text-xs text-muted-foreground">Remotes</dt>
        <dd class="truncate text-xs">{gitRemotes.length > 0 ? gitRemotes.map((remote) => stringValue(remote.name) ?? "remote").join(", ") : "—"}</dd>
      </dl>
      <div class="flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" disabled>Fetch</Button>
        <Button size="xs" variant="outline" disabled>Pull</Button>
        <Button size="xs" variant="outline" disabled>Push</Button>
      </div>
    </div>
  </PanelSection>

  <PanelSection title="Changes" icon={FilePen} bind:open={changesOpen}>
    <div class="flex flex-col gap-2">
      <p class="rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground">
        No working-tree change list is available in this UI pass. Branch, staging,
        discard, and diff actions are disabled until backend reporting lands.
      </p>
      <div class="flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" disabled>Stage all</Button>
        <Button size="xs" variant="outline" disabled>Refresh status</Button>
      </div>
    </div>
  </PanelSection>

  <PanelSection title="Git setup" icon={Settings} bind:open={setupOpen}>
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap gap-1.5">
        <Badge tone={setupTone(status?.setup?.git)} size="xs">git: {formatSetup(status?.setup?.git)}</Badge>
        <Badge tone={setupTone(status?.setup?.github)} size="xs">github: {formatSetup(status?.setup?.github)}</Badge>
      </div>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt class="text-xs text-muted-foreground">Author</dt>
        <dd class="truncate text-xs">{stringValue(gitIdentity.name) ?? "—"}{#if stringValue(gitIdentity.email)} <span class="text-muted-foreground">{stringValue(gitIdentity.email)}</span>{/if}</dd>
        <dt class="text-xs text-muted-foreground">GitHub</dt>
        <dd class="truncate text-xs">{stringValue(githubConfig.host) ?? "github.com"} · enabled {booleanLabel(githubConfig.enabled)}</dd>
        <dt class="text-xs text-muted-foreground">LFS</dt>
        <dd class="truncate text-xs">{booleanLabel(gitConfig.lfs)}</dd>
        <dt class="text-xs text-muted-foreground">Config</dt>
        <dd class="truncate font-mono text-xs">{status?.configDigest ?? record.configDigest ?? "—"}</dd>
      </dl>
      {#if status?.setup?.git?.error || status?.setup?.github?.error}
        <p class="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {status.setup.git?.error?.message ?? status.setup.github?.error?.message}
        </p>
      {/if}
      <Button size="xs" variant="outline" onclick={() => onOpenDiagnosticTab?.("config")}>Open config YAML</Button>
    </div>
  </PanelSection>
</div>
