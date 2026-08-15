<script lang="ts">
import type {
  ApplicationConfigurationSnapshot,
  StatusResponse,
  UpdateApplicationConfigurationRequest,
} from "$lib/api";
import {
  SettingsFieldRow,
  SettingsInlineMessage,
  SettingsSection,
  SettingsSelectRow,
  SettingsStatGrid,
  SettingsToggleRow,
  type SettingsStat,
} from "$lib/presentation/components/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SelectField from "@nervekit/ui-kit/components/ui/select-field";

const ozoneOptions = [
  { value: "auto", label: "Auto" },
  { value: "x11", label: "X11" },
  { value: "wayland", label: "Wayland" },
];
const fontOptions = [
  { value: "system", label: "System" },
  { value: "none", label: "None" },
  { value: "slight", label: "Slight" },
  { value: "medium", label: "Medium" },
  { value: "full", label: "Full" },
];
const logLevelOptions = [
  { value: "debug", label: "Debug" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warning" },
  { value: "error", label: "Error" },
];

type ResolvedLeaf = {
  activeValue: unknown;
  savedValue: unknown;
  editable: boolean;
  source: { kind: string; name?: string };
  restartTarget: "none" | "daemon" | "desktop";
  pendingRestart: boolean;
};

type Props = {
  configuration?: ApplicationConfigurationSnapshot;
  status?: StatusResponse;
  daemonCapability?: {
    mode?: "local" | "remote";
    owned: boolean;
    canRestart: boolean;
  };
  daemonRestarting?: boolean;
  onConfigurationChange?: (
    patch: UpdateApplicationConfigurationRequest,
  ) => void;
  onRestartDaemon?: () => void;
};

let {
  configuration,
  status,
  daemonCapability,
  daemonRestarting = false,
  onConfigurationChange,
  onRestartDaemon,
}: Props = $props();

function formatSettingValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return String(value);
}

function controlValue<T>(setting: {
  activeValue: T;
  savedValue: T;
  editable: boolean;
}): T {
  return setting.editable ? setting.savedValue : setting.activeValue;
}

function describe(base: string, setting: ResolvedLeaf): string {
  if (!setting.editable) {
    const saved = Object.is(setting.activeValue, setting.savedValue)
      ? ""
      : ` Saved setting: ${formatSettingValue(setting.savedValue)}.`;
    return `${base} Controlled by ${setting.source.name ?? setting.source.kind}.${saved} Unset the override to edit it here.`;
  }
  if (setting.pendingRestart) {
    return `${base} Pending restart; currently active: ${formatSettingValue(setting.activeValue)}.`;
  }
  return base;
}

function save(patch: UpdateApplicationConfigurationRequest): void {
  onConfigurationChange?.(patch);
}

function saveNumber(
  value: string,
  minimum: number,
  apply: (value: number) => UpdateApplicationConfigurationRequest,
): void {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) return;
  save(apply(parsed));
}

const pendingDaemonRestart = $derived(
  configuration
    ? Object.values(configuration.application).some((group) =>
        Object.values(group).some(
          (item) => item.pendingRestart && item.restartTarget === "daemon",
        ),
      )
    : false,
);
const pendingDesktopRestart = $derived(
  configuration
    ? Object.values(configuration.application).some((group) =>
        Object.values(group).some(
          (item) => item.pendingRestart && item.restartTarget === "desktop",
        ),
      )
    : false,
);

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
  { label: "SQLite", value: status?.storage?.sqlitePath ?? "—", wide: true },
]);
</script>

{#if configuration}
  {#if pendingDaemonRestart || pendingDesktopRestart}
    <div class="flex items-center gap-2">
      <SettingsInlineMessage
        class="min-w-0 flex-1"
        tone="warning"
        text={`${pendingDaemonRestart ? "Changes saved. Restart the daemon to apply them." : ""}${pendingDesktopRestart ? " Restart Nerve to apply desktop changes." : ""}`}
      />
      {#if pendingDaemonRestart && daemonCapability?.canRestart}
        <Button size="xs" disabled={daemonRestarting} onclick={onRestartDaemon}>
          {daemonRestarting ? "Restarting…" : "Restart daemon"}
        </Button>
      {/if}
    </div>
  {/if}

  <SettingsSection
    id="network"
    title="Network"
    description="Configure the daemon listener and optional LAN/PWA access."
  >
    <SettingsToggleRow
      label="Allow remote connections"
      description={describe(
        "Bind to the local network so trusted devices can connect.",
        configuration.application.network.allowRemote,
      )}
      checked={controlValue(configuration.application.network.allowRemote)}
      disabled={!configuration.application.network.allowRemote.editable}
      onCheckedChange={(allowRemote) =>
        save({ application: { network: { allowRemote } } })}
    />
    <div class="grid gap-3 sm:grid-cols-2">
      <SettingsFieldRow
        id="settings-server-host"
        label="Bind host"
        value={String(controlValue(configuration.application.network.host))}
        disabled={!configuration.application.network.host.editable}
        hint={describe(
          "Use 127.0.0.1 for local-only or 0.0.0.0 for all interfaces.",
          configuration.application.network.host,
        )}
        onValueChange={(host) => save({ application: { network: { host } } })}
      />
      <SettingsFieldRow
        id="settings-server-port"
        label="HTTP port"
        type="number"
        min={1}
        max={65535}
        value={String(controlValue(configuration.application.network.port))}
        disabled={!configuration.application.network.port.editable}
        hint={describe(
          "Port used by the desktop and browser workbench.",
          configuration.application.network.port,
        )}
        onValueChange={(value) =>
          saveNumber(value, 1, (port) => ({
            application: { network: { port } },
          }))}
      />
    </div>
    <SettingsToggleRow
      label="Mobile HTTPS"
      description={describe(
        "Serve a local-CA HTTPS endpoint for installable mobile PWA access.",
        configuration.application.network.mobileHttps,
      )}
      checked={controlValue(configuration.application.network.mobileHttps)}
      disabled={!configuration.application.network.mobileHttps.editable}
      onCheckedChange={(mobileHttps) =>
        save({ application: { network: { mobileHttps } } })}
    />
    <SettingsFieldRow
      id="settings-https-port"
      label="HTTPS port"
      type="number"
      min={1}
      max={65535}
      value={String(controlValue(configuration.application.network.httpsPort))}
      disabled={!configuration.application.network.httpsPort.editable}
      hint={describe(
        "Used only when Mobile HTTPS is enabled.",
        configuration.application.network.httpsPort,
      )}
      onValueChange={(value) =>
        saveNumber(value, 1, (httpsPort) => ({
          application: { network: { httpsPort } },
        }))}
    />
  </SettingsSection>

  <SettingsSection id="diagnostics" title="Diagnostics">
    <SettingsToggleRow
      label="Application logging"
      description={describe(
        "Write desktop and daemon application logs under the data directory.",
        configuration.application.diagnostics.loggingEnabled,
      )}
      checked={controlValue(
        configuration.application.diagnostics.loggingEnabled,
      )}
      disabled={!configuration.application.diagnostics.loggingEnabled.editable}
      onCheckedChange={(loggingEnabled) =>
        save({ application: { diagnostics: { loggingEnabled } } })}
    />
    <SettingsToggleRow
      label="Performance sampling"
      description={describe(
        "Write lightweight local process and subsystem samples for profiling.",
        configuration.application.diagnostics.performanceEnabled,
      )}
      checked={controlValue(
        configuration.application.diagnostics.performanceEnabled,
      )}
      disabled={!configuration.application.diagnostics.performanceEnabled
        .editable}
      onCheckedChange={(performanceEnabled) =>
        save({ application: { diagnostics: { performanceEnabled } } })}
    />
    <SettingsSelectRow
      label="Log level"
      description={describe(
        "Minimum severity written by the daemon logger.",
        configuration.application.diagnostics.level,
      )}
    >
      {#snippet control(disabled)}
        <SelectField
          items={logLevelOptions}
          value={controlValue(configuration.application.diagnostics.level)}
          ariaLabel="Log level"
          {disabled}
          onValueChange={(level) =>
            save({
              logging: {
                level: level as "debug" | "info" | "warn" | "error",
              },
            })}
        />
      {/snippet}
    </SettingsSelectRow>
    <div class="grid gap-3 sm:grid-cols-2">
      <SettingsFieldRow
        id="settings-log-retention"
        label="Log retention"
        type="number"
        min={1}
        suffix="days"
        value={String(
          controlValue(configuration.application.diagnostics.retentionDays),
        )}
        hint={describe(
          "How long application log files are retained.",
          configuration.application.diagnostics.retentionDays,
        )}
        onValueChange={(value) =>
          saveNumber(value, 1, (retentionDays) => ({
            logging: { retentionDays },
          }))}
      />
      <SettingsFieldRow
        id="settings-log-buffer"
        label="Buffered records"
        type="number"
        min={1}
        value={String(
          controlValue(configuration.application.diagnostics.maxBufferedLogs),
        )}
        hint={describe(
          "Maximum recent records kept available for the Logs view.",
          configuration.application.diagnostics.maxBufferedLogs,
        )}
        onValueChange={(value) =>
          saveNumber(value, 1, (maxBufferedLogs) => ({
            logging: { maxBufferedLogs },
          }))}
      />
    </div>
  </SettingsSection>

  <SettingsSection id="daemon" title="Daemon">
    <div class="grid gap-3 sm:grid-cols-2">
      <SettingsFieldRow
        id="settings-startup-timeout"
        label="Startup timeout"
        type="number"
        min={1}
        suffix="ms"
        value={String(
          controlValue(configuration.application.daemon.startupTimeoutMs),
        )}
        disabled={!configuration.application.daemon.startupTimeoutMs.editable}
        hint={describe(
          "How long Electron waits for an owned daemon.",
          configuration.application.daemon.startupTimeoutMs,
        )}
        onValueChange={(value) =>
          saveNumber(value, 1, (startupTimeoutMs) => ({
            application: { daemon: { startupTimeoutMs } },
          }))}
      />
      <SettingsFieldRow
        id="settings-daemon-heap"
        label="Maximum heap"
        type="number"
        min={1}
        suffix="MB"
        value={String(
          controlValue(configuration.application.daemon.maxOldSpaceMb),
        )}
        disabled={!configuration.application.daemon.maxOldSpaceMb.editable}
        hint={describe(
          "Node.js old-space limit for an owned daemon.",
          configuration.application.daemon.maxOldSpaceMb,
        )}
        onValueChange={(value) =>
          saveNumber(value, 1, (maxOldSpaceMb) => ({
            application: { daemon: { maxOldSpaceMb } },
          }))}
      />
    </div>
  </SettingsSection>

  <SettingsSection
    id="desktop-rendering"
    title="Desktop rendering"
    description="Linux Electron startup options. Restart Nerve after changing them."
  >
    {#if configuration.context.platform === "linux"}
      <SettingsSelectRow
        label="Ozone platform"
        disabled={!configuration.application.electron.ozonePlatform.editable}
        description={describe(
          "Choose automatic, X11, or Wayland rendering.",
          configuration.application.electron.ozonePlatform,
        )}
      >
        {#snippet control(disabled)}
          <SelectField
            items={ozoneOptions}
            value={controlValue(
              configuration.application.electron.ozonePlatform,
            )}
            ariaLabel="Ozone platform"
            {disabled}
            onValueChange={(ozonePlatform) =>
              save({
                application: {
                  electron: {
                    ozonePlatform: ozonePlatform as "auto" | "x11" | "wayland",
                  },
                },
              })}
          />
        {/snippet}
      </SettingsSelectRow>
      <SettingsSelectRow
        label="Font render hinting"
        disabled={!configuration.application.electron.fontRenderHinting
          .editable}
        description={describe(
          "Control Chromium font hinting on Linux.",
          configuration.application.electron.fontRenderHinting,
        )}
      >
        {#snippet control(disabled)}
          <SelectField
            items={fontOptions}
            value={controlValue(
              configuration.application.electron.fontRenderHinting,
            )}
            ariaLabel="Font render hinting"
            {disabled}
            onValueChange={(fontRenderHinting) =>
              save({
                application: {
                  electron: {
                    fontRenderHinting: fontRenderHinting as
                      "system" | "none" | "slight" | "medium" | "full",
                  },
                },
              })}
          />
        {/snippet}
      </SettingsSelectRow>
    {:else}
      <SettingsInlineMessage
        text="Electron rendering controls apply only to the Linux desktop app."
      />
    {/if}
  </SettingsSection>

  <SettingsSection id="launch-context" title="Launch context">
    <SettingsStatGrid
      items={[
        {
          label: "Data directory source",
          value: configuration.context.dataDirSource,
        },
        { label: "Platform", value: configuration.context.platform },
        {
          label: "Daemon mode",
          value: daemonCapability?.mode ?? "browser or unavailable",
        },
        {
          label: "Daemon ownership",
          value: daemonCapability?.owned ? "owned" : "not owned",
        },
        {
          label: "Web assets",
          value: configuration.context.webAssetsOverridden
            ? "overridden"
            : "bundled/default",
        },
        {
          label: "Proxy",
          value: configuration.context.proxyConfigured
            ? "configured"
            : "not configured",
        },
      ]}
    />
  </SettingsSection>
{/if}

<SettingsSection id="system-information" title="System information">
  <SettingsStatGrid items={diagnostics} />
</SettingsSection>
