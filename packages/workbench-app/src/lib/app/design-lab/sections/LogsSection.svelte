<script lang="ts">
import type { ApplicationLogRecord } from "@nervekit/contracts/logs";
import LogRow from "$lib/presentation/logs/LogRow.svelte";
import LogStream from "$lib/presentation/logs/LogStream.svelte";
import LogsFloatingToolbar from "$lib/presentation/logs/LogsFloatingToolbar.svelte";
import LogsPane from "$lib/presentation/logs/LogsPane.svelte";
import type {
  LogsLevelFilter,
  LogsPaneActions,
  LogsPaneModel,
  LogsSourceFilter,
} from "$lib/presentation/logs/logs-pane-types";
import type { LogStreamLine } from "$lib/presentation/logs/log-stream";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

const now = Date.parse("2026-10-14T19:29:31.000Z");
let seq = 0;
function log(
  partial: Pick<ApplicationLogRecord, "level" | "message"> &
    Partial<ApplicationLogRecord>,
): ApplicationLogRecord {
  seq += 1;
  return {
    seq,
    id: `log_${seq}`,
    ts: new Date(now - (20 - seq) * 61_000).toISOString(),
    source: "orchestrator",
    component: "http",
    ...partial,
  };
}

const iconWarn = (id: string, ms: number) =>
  log({
    level: "warn",
    message: `GET /api/projects/${id}/icon completed (404)`,
    durationMs: ms,
  });

const sampleLogs: ApplicationLogRecord[] = [
  log({
    level: "debug",
    message: "Resolved provider credentials",
    component: "providers",
    context: { provider: "anthropic" },
  }),
  log({
    level: "info",
    message: "Run started",
    component: "runs",
    runId: "run_01HZX",
    conversationId: "conv_01HZY",
    context: { model: "claude-sonnet-4", mode: "agent" },
  }),
  iconWarn("proj_01M1EM0QPE1SGEH6H2T939E3W4", 2),
  iconWarn("proj_01M0308T8D6SRQGR3RPQNK0T8", 3),
  log({
    level: "error",
    message: "GET /api/filesystem/file completed (500)",
    durationMs: 4,
    error: {
      name: "SqliteError",
      message: "database is locked",
      stack:
        "SqliteError: database is locked\n    at Database.exec (storage.ts:211:9)\n    at persist (snapshots.ts:48:5)",
      cause: "SQLITE_BUSY",
    },
    context: { operation: "snapshot.write" },
  }),
  log({
    level: "warn",
    message: "Conversation channel failed",
    component: "daemon",
  }),
  log({
    level: "error",
    message: "Unhandled browser error",
    component: "web-runtime",
    source: "web",
    context: {
      filename: "http://localhost:5173/node_modules/.vite/deps/chunk.js",
    },
  }),
  log({
    level: "info",
    message:
      "A very long log message that keeps going well past the width of the pane so the row has to truncate it with an ellipsis rather than wrapping onto a second line",
    component: "a-component-with-a-long-name",
    source: "desktop",
  }),
];

const noop = () => {};
const actions: LogsPaneActions = {
  onLevelChange: noop as (value: LogsLevelFilter) => void,
  onSourceChange: noop as (value: LogsSourceFilter) => void,
  onComponentChange: noop,
  onContainsChange: noop,
  onClearFilters: noop,
  onRefresh: noop,
  onLoadEarlier: noop,
  onCopy: noop,
  onCopySelection: noop,
  onPrune: () => false,
};

const baseModel: LogsPaneModel = {
  rows: sampleLogs,
  level: "all",
  source: "all",
  component: "",
  contains: "",
  hasMoreBefore: false,
  loading: false,
  loadingEarlier: false,
  pruning: false,
  filtersActive: false,
  pruneDescription: "This permanently removes the retained application logs.",
};

const paneStates: { title: string; model: LogsPaneModel }[] = [
  {
    title: "Loading (empty)",
    model: { ...baseModel, rows: [], loading: true },
  },
  {
    title: "Empty (filtered)",
    model: { ...baseModel, rows: [], filtersActive: true, level: "error" },
  },
  {
    title: "Load error banner",
    model: {
      ...baseModel,
      error: "Could not reach the daemon to read logs.",
    },
  },
  {
    title: "Older logs available, history error",
    model: {
      ...baseModel,
      hasMoreBefore: true,
      historyError: "Network down",
    },
  },
];

let openLogs = $state<Record<string, boolean>>({});
let findText = $state("");

const streamLines: LogStreamLine[] = [
  { key: "1", text: "> nerve-workbench@0.1.0 build" },
  { key: "2", text: "vite v6 building for production..." },
  {
    key: "3",
    text: "warning: chunk size exceeds 500 kB",
    tone: "warn",
    stream: "stderr",
    level: "warn",
  },
  {
    key: "4",
    text: "error: Cannot find module './missing' imported from src/main.ts",
    tone: "error",
    stream: "stderr",
    level: "error",
  },
  { key: "5", text: "✓ built in 4.21s" },
];
</script>

<div class="flex flex-col gap-10">
  <GalleryGroup
    title="In context"
    description="The Logs center tab: a LogsPane filling the editor area (about 800 × 480 here). Right-click for the filter menu; Ctrl/⌘F opens find."
  >
    <GallerySpecimen
      title="LogsPane"
      source="presentation/logs/LogsPane"
      usage="1 file · logs"
      surface="well"
      layout="bare"
    >
      <div class="h-120 w-full max-w-200 overflow-hidden rounded-md border">
        <LogsPane model={baseModel} {actions} />
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="LogsPane states"
      description="Empty and error states that occur: first load, filters matching nothing, daemon unreachable, history fetch failed."
      surface="well"
      layout="bare"
    >
      <div class="grid gap-4 xl:grid-cols-2">
        {#each paneStates as state (state.title)}
          <div class="flex flex-col gap-1">
            <span class="text-xs text-muted-foreground">{state.title}</span>
            <div class="h-56 overflow-hidden rounded-md border">
              <LogsPane model={state.model} {actions} />
            </div>
          </div>
        {/each}
      </div>
    </GallerySpecimen>
  </GalleryGroup>

  <GalleryGroup
    title="Rows and toolbar"
    description="Parts of the pane, shown in isolation."
  >
    <GallerySpecimen
      title="LogRow"
      source="presentation/logs/LogRow"
      usage="1 file · logs"
      description="Debug, info, warn, error (expandable with stack) and a truncated long message. Rows with detail expand on click."
      layout="stack"
    >
      <div class="max-w-200 rounded-md border">
        {#each sampleLogs as entry (entry.id)}
          <LogRow
            log={entry}
            open={openLogs[entry.id] ?? false}
            onToggle={() => (openLogs[entry.id] = !openLogs[entry.id])}
          />
        {/each}
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="LogsFloatingToolbar"
      source="presentation/logs/LogsFloatingToolbar"
      usage="1 file · logs"
      description="Find bar pinned to the top of the pane: idle and loading with an active query."
      layout="bare"
    >
      <div class="grid max-w-200 gap-3">
        <div
          class="relative h-16 overflow-hidden rounded-md border bg-background"
        >
          <LogsFloatingToolbar
            contains={findText}
            rowCount={sampleLogs.length}
            loading={false}
            focusRequest={0}
            onContainsChange={(value) => (findText = value)}
            onClose={noop}
          />
        </div>
        <div
          class="relative h-16 overflow-hidden rounded-md border bg-background"
        >
          <LogsFloatingToolbar
            contains="timeout"
            rowCount={0}
            loading
            focusRequest={0}
            onContainsChange={noop}
            onClose={noop}
          />
        </div>
      </div>
    </GallerySpecimen>

    <GallerySpecimen
      title="LogStream"
      source="presentation/logs/LogStream"
      usage="2 files · conversation, launches"
      description="Terminal-style output for launches and bash runs: normal, warn and error lines; empty; load error."
      layout="bare"
    >
      <div class="grid gap-4 md:grid-cols-3">
        <div class="h-44 overflow-hidden rounded-md border">
          <LogStream
            scopeKey="logs-a"
            ariaLabel="Build output"
            command="pnpm build"
            lines={streamLines}
          />
        </div>
        <div class="h-44 overflow-hidden rounded-md border">
          <LogStream scopeKey="logs-b" ariaLabel="Empty output" lines={[]} />
        </div>
        <div class="h-44 overflow-hidden rounded-md border">
          <LogStream
            scopeKey="logs-c"
            ariaLabel="Load error"
            lines={streamLines.slice(0, 2)}
            loadError="Daemon unreachable"
            onJumpToLatest={noop}
          />
        </div>
      </div>
    </GallerySpecimen>
  </GalleryGroup>
</div>
