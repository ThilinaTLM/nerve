<script lang="ts">
  import Server from "@lucide/svelte/icons/server";
  import type { Settings, UpdateSettingsRequest } from "../../../../api";
  import { Input } from "$lib/components/ui/input";
  import Switch from "$lib/components/ui/switch-field";

  type SettingsChange = (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;

  type Props = {
    settingsDraft: Settings;
    onSettingsChange?: SettingsChange;
  };

  let { settingsDraft, onSettingsChange }: Props = $props();

  function updateHost(value: string) {
    settingsDraft.server.host = value;
    onSettingsChange?.({ server: { host: value } }, { debounceMs: 650 });
  }

  function updateServerPort(value: string) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      const port = Math.floor(parsed);
      settingsDraft.server.port = port;
      onSettingsChange?.({ server: { port } }, { debounceMs: 650 });
    }
  }
</script>

<section id="settings-server" class="settings-section" data-section="server">
  <header class="settings-section-header">
    <div class="settings-section-kicker"><Server size={14} strokeWidth={2.1} /> Server</div>
    <h2>Server binding</h2>
    <p>Host, port, and remote access settings are persisted immediately but apply after daemon restart.</p>
  </header>
  <div class="settings-section-body">
    <div class="settings-field-grid">
      <label>
        <span>Host</span>
        <Input
          value={settingsDraft.server.host}
          size="sm"
          ariaLabel="Server host"
          oninput={(event) => updateHost((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label>
        <span>Port</span>
        <Input
          value={String(settingsDraft.server.port)}
          type="number"
          size="sm"
          ariaLabel="Server port"
          oninput={(event) => updateServerPort((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
    </div>

    <div class="settings-row">
      <Switch
        class="settings-full-switch"
        bind:checked={settingsDraft.server.allowRemote}
        label="Allow remote connections"
        description="Keep local binding unless remote access is required."
        onCheckedChange={(checked) => {
          settingsDraft.server.allowRemote = checked;
          onSettingsChange?.({ server: { allowRemote: checked } }, { immediate: true });
        }}
      />
    </div>

    <p class="settings-note">Restart the daemon after changing host, port, or remote access.</p>
  </div>
</section>
