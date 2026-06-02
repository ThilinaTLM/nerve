<script lang="ts">
  import Server from "lucide-svelte/icons/server";
  import Shield from "lucide-svelte/icons/shield";
  import type { Settings } from "../../../../api";
  import Input from "../../../ui/Input.svelte";
  import Switch from "../../../ui/Switch.svelte";

  type Props = {
    settingsDraft: Settings;
  };

  let { settingsDraft }: Props = $props();

  function updateNumber(path: "thresholdTokens" | "keepRecentTokens", value: string) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      settingsDraft.compaction[path] = Math.floor(parsed);
    }
  }

  function updateServerPort(value: string) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      settingsDraft.server.port = Math.floor(parsed);
    }
  }
</script>

<section class="settings-card" data-section="network">
  <div class="card-head">
    <div class="card-icon"><Server size={16} strokeWidth={2.2} /></div>
    <div>
      <span class="eyebrow">Network</span>
      <h2>Server binding and compaction</h2>
      <p>Host and port changes apply after daemon restart. Keep local binding unless remote access is required.</p>
    </div>
  </div>
  <div class="server-grid">
    <label>
      Host<Input
        value={settingsDraft.server.host}
        size="sm"
        ariaLabel="Server host"
        oninput={(event) => {
          settingsDraft.server.host = (event.currentTarget as HTMLInputElement).value;
        }}
      />
    </label>
    <label>
      Port<Input
        value={String(settingsDraft.server.port)}
        type="number"
        size="sm"
        ariaLabel="Server port"
        oninput={(event) => updateServerPort((event.currentTarget as HTMLInputElement).value)}
      />
    </label>
  </div>
  <div class="switch-card">
    <Switch
      bind:checked={settingsDraft.server.allowRemote}
      label="Allow remote connections"
      description="Restart the daemon after changing host, port, or remote access."
    />
  </div>
  <div class="compaction-card">
    <div>
      <Shield size={14} strokeWidth={2.2} />
      <strong>Transcript compaction</strong>
    </div>
    <Switch
      bind:checked={settingsDraft.compaction.auto}
      label="Auto-compact sessions"
      description="Let the daemon compact long branches when thresholds are reached."
    />
    <div class="server-grid">
      <label>
        Threshold tokens<Input
          value={String(settingsDraft.compaction.thresholdTokens)}
          type="number"
          size="sm"
          ariaLabel="Compaction threshold tokens"
          oninput={(event) => updateNumber("thresholdTokens", (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label>
        Keep recent<Input
          value={String(settingsDraft.compaction.keepRecentTokens)}
          type="number"
          size="sm"
          ariaLabel="Keep recent tokens"
          oninput={(event) => updateNumber("keepRecentTokens", (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
    </div>
  </div>
</section>
