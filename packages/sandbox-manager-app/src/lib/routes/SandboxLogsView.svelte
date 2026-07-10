<script lang="ts">
import { RefreshCw, Terminal, TriangleAlert } from "@lucide/svelte";
import type {
  ManagedSandboxRecord,
  StructuredLogLevel,
} from "@nervekit/contracts";
import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
import { Button } from "@nervekit/workbench-ui/components/ui/button";
import { CodeViewer } from "@nervekit/workbench-ui/components/workbench";
import { sandboxLifecycleView } from "../state/sandbox-lifecycle-view";
import { parseSandboxLogChunks } from "../state/sandbox-log-lines";
import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";

let { record }: { record: ManagedSandboxRecord } = $props();

const store = useSandboxManagerStore();
const detail = $derived(store.details[record.sandboxId]);
const lifecycle = $derived(sandboxLifecycleView(record, detail));
const unavailable = $derived(detail?.logsAvailable === false);
const limitations = $derived(detail?.logsLimitations ?? []);
const lines = $derived(parseSandboxLogChunks(detail?.logChunks ?? []));
let mode = $state<"structured" | "raw">("structured");

$effect(() => {
  if (
    detail &&
    detail.logsText === "" &&
    detail.logsAvailable !== false &&
    limitations.length === 0
  )
    void store.loadLogs(record.sandboxId);
});

$effect(() => {
  if (
    !["creating", "connecting", "starting", "reconnecting"].includes(
      lifecycle.state,
    )
  )
    return;
  const timer = window.setInterval(() => {
    void store.loadLogs(record.sandboxId);
  }, 2_000);
  return () => window.clearInterval(timer);
});

function tone(
  level: StructuredLogLevel | undefined,
): "neutral" | "accent" | "warn" | "danger" {
  if (level === "error") return "danger";
  if (level === "warn") return "warn";
  if (level === "info") return "accent";
  return "neutral";
}

function formatTime(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString(undefined, { hour12: false });
}

function compactContext(context: Record<string, unknown>): string {
  return Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .map(
      ([key, value]) =>
        `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    )
    .join(" · ");
}
</script>

<div class="relative flex h-full min-h-0 flex-col bg-background">
  <div
    class="flex flex-none items-center justify-between gap-2 border-b px-3 py-2"
  >
    <div class="min-w-0">
      <p class="text-sm font-medium">Container logs</p>
      <p class="truncate text-xs text-muted-foreground">
        {lifecycle.state === "ready"
          ? "Startup complete"
          : lifecycle.description}
      </p>
    </div>
    <div class="flex items-center gap-1">
      <div class="flex rounded-md border p-0.5">
        <Button
          variant={mode === "structured" ? "secondary" : "ghost"}
          size="xs"
          onclick={() => (mode = "structured")}>Structured</Button
        >
        <Button
          variant={mode === "raw" ? "secondary" : "ghost"}
          size="xs"
          onclick={() => (mode = "raw")}>Raw</Button
        >
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Refresh logs"
        onclick={() => void store.loadLogs(record.sandboxId)}
      >
        <RefreshCw class="size-3.5" />
      </Button>
    </div>
  </div>

  {#if unavailable}
    <div
      class="grid flex-1 place-content-center gap-2 p-4 text-center text-muted-foreground"
    >
      <TriangleAlert class="mx-auto size-7 text-warning" strokeWidth={1.7} />
      <p class="text-sm text-foreground">Container logs unavailable.</p>
      {#if limitations.length > 0}
        <ul class="mx-auto max-w-md list-disc text-left text-xs">
          {#each limitations as limitation (limitation)}
            <li>{limitation}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else if !detail || detail.logsText.length === 0}
    <div
      class="grid flex-1 place-content-center gap-1 text-center text-muted-foreground"
    >
      <Terminal class="mx-auto size-7 text-primary" strokeWidth={1.7} />
      <p class="text-sm text-foreground">Waiting for the first log entry…</p>
    </div>
  {:else}
    {#if detail.logsTruncated}
      <p
        class="flex-none border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      >
        Showing the most recent bounded log output.
      </p>
    {/if}
    {#if mode === "raw"}
      <div class="min-h-0 flex-1 overflow-auto p-3">
        <CodeViewer text={detail.logsText} wrap />
      </div>
    {:else}
      <div class="min-h-0 flex-1 overflow-auto">
        <ol class="divide-y">
          {#each lines as line (line.id)}
            <li
              class="grid grid-cols-[5.5rem_4.5rem_minmax(0,1fr)] gap-2 px-3 py-2 text-xs"
            >
              <time class="font-mono text-muted-foreground" title={line.ts}>
                {formatTime(line.ts)}
              </time>
              <Badge tone={tone(line.level)} size="xs" class="w-fit">
                {line.level ?? line.stream}
              </Badge>
              <div class="min-w-0">
                <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span
                    class={line.level === "error"
                      ? "font-medium text-destructive"
                      : "text-foreground"}
                  >
                    {line.message}
                  </span>
                  {#if line.stage || line.phase}
                    <span class="font-mono text-muted-foreground">
                      {line.stage ?? line.phase}
                    </span>
                  {/if}
                </div>
                {#if Object.keys(line.context).length > 0}
                  <details class="mt-1 text-muted-foreground">
                    <summary class="cursor-pointer select-none">Details</summary
                    >
                    <p class="mt-1 break-words font-mono leading-relaxed">
                      {compactContext(line.context)}
                    </p>
                  </details>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  {/if}
</div>
