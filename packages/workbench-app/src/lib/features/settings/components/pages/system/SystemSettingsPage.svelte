<script lang="ts">
import type { Settings, StatusResponse } from "$lib/api";
import {
  SettingsFieldRow,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsStatGrid,
  SettingsToggleRow,
  type SettingsStat,
} from "$lib/presentation/components/settings";
import type { SettingsChange } from "../settings-change";

type Props = {
  activeTabId: string;
  settingsDraft: Settings;
  status?: StatusResponse;
  onSettingsChange?: SettingsChange;
};

let { activeTabId, settingsDraft, status, onSettingsChange }: Props = $props();

function updateHost(value: string): void {
  settingsDraft.server.host = value;
  onSettingsChange?.({ server: { host: value } }, { debounceMs: 650 });
}

function updateServerPort(value: string): void {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return;
  const port = Math.floor(parsed);
  settingsDraft.server.port = port;
  onSettingsChange?.({ server: { port } }, { debounceMs: 650 });
}

function setAllowRemote(checked: boolean): void {
  settingsDraft.server.allowRemote = checked;
  onSettingsChange?.({ server: { allowRemote: checked } }, { immediate: true });
}

const diagnostics = $derived<SettingsStat[]>([
  { label: "Daemon", value: status?.daemonId ?? "not loaded" },
  { label: "Version", value: status?.version ?? "—" },
  {
    label: "Started",
    value: status?.startedAt
      ? new Date(status.startedAt).toLocaleString()
      : "—",
  },
  {
    label: "Index",
    value: status?.storage?.indexHealthy ? "healthy" : "unknown",
  },
  { label: "Data directory", value: status?.dataDir ?? "—", wide: true },
  {
    label: "SQLite",
    value: status?.storage?.sqlitePath ?? "—",
    wide: true,
  },
]);
</script>

{#if activeTabId === "server"}
  <SettingsGroup>
    <div class="grid gap-3 sm:grid-cols-2">
      <SettingsFieldRow
        id="settings-server-host"
        label="Host"
        value={settingsDraft.server.host}
        onValueChange={updateHost}
      />
      <SettingsFieldRow
        id="settings-server-port"
        label="Port"
        type="number"
        value={String(settingsDraft.server.port)}
        onValueChange={updateServerPort}
      />
    </div>
    <SettingsToggleRow
      label="Allow remote connections"
      bind:checked={settingsDraft.server.allowRemote}
      onCheckedChange={setAllowRemote}
    />
    <SettingsInlineMessage
      tone="warning"
      text="Restart the daemon after changing host, port, or remote access."
    />
  </SettingsGroup>
{:else if activeTabId === "diagnostics"}
  <SettingsGroup>
    <SettingsStatGrid items={diagnostics} />
  </SettingsGroup>
{/if}
