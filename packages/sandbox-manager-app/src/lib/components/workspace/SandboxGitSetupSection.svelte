<script lang="ts">
import Settings from "@lucide/svelte/icons/settings";
import type {
  ManagedSandboxRecord,
  StartupSetupStatus,
} from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { PanelSection } from "@nervekit/workbench-ui/components/workbench";
import type {
  SandboxDetailState,
  SandboxDiagnosticTabId,
} from "../../state/sandbox-ui-types";

type PlainRecord = Record<string, unknown>;

let {
  record,
  detail,
  onOpenDiagnosticTab,
  open = $bindable(true),
  onOpenChange,
}: {
  record: ManagedSandboxRecord;
  detail?: SandboxDetailState;
  onOpenDiagnosticTab?: (id: SandboxDiagnosticTabId) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = $props();
const status = $derived(detail?.status ?? detail?.snapshot);
const config = $derived(asRecord(status?.config));
const gitConfig = $derived(asRecord(config.git));
const githubConfig = $derived(asRecord(config.github));
const gitIdentity = $derived(asRecord(gitConfig.identity));

function asRecord(value: unknown): PlainRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as PlainRecord)
    : {};
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

function setupTone(
  value: StartupSetupStatus | undefined,
): "good" | "warn" | "danger" | "running" | "neutral" {
  if (!value) return "neutral";
  if (value.status === "completed") return "good";
  if (value.status === "failed") return "danger";
  if (value.status === "started") return "running";
  if (value.status === "degraded") return "warn";
  return "neutral";
}

function formatSetup(value: StartupSetupStatus | undefined): string {
  if (!value) return "not reported";
  return value.configured ? value.status : `not configured · ${value.status}`;
}
</script>

<PanelSection title="Git setup" icon={Settings} bind:open {onOpenChange}>
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
      <dd class="truncate text-xs">
        {stringValue(gitIdentity.name) ?? "—"}
        {#if stringValue(gitIdentity.email)}
          <span class="text-muted-foreground"
            >{stringValue(gitIdentity.email)}</span
          >
        {/if}
      </dd>
      <dt class="text-xs text-muted-foreground">GitHub</dt>
      <dd class="truncate text-xs">
        {stringValue(githubConfig.host) ?? "github.com"} · enabled {booleanLabel(
          githubConfig.enabled,
        )}
      </dd>
      <dt class="text-xs text-muted-foreground">LFS</dt>
      <dd class="truncate text-xs">{booleanLabel(gitConfig.lfs)}</dd>
      <dt class="text-xs text-muted-foreground">Config</dt>
      <dd class="truncate font-mono text-xs">
        {status?.configDigest ?? record.configDigest ?? "—"}
      </dd>
    </dl>
    {#if status?.setup?.git?.error || status?.setup?.github?.error}
      <p class="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
        {status.setup.git?.error?.message ??
          status.setup.github?.error?.message}
      </p>
    {/if}
    <Button
      size="xs"
      variant="outline"
      onclick={() => onOpenDiagnosticTab?.("config")}
    >
      Open config YAML
    </Button>
  </div>
</PanelSection>
