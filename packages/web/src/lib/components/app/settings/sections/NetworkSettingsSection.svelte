<script lang="ts">
  import Server from "@lucide/svelte/icons/server";
  import Shield from "@lucide/svelte/icons/shield";
  import type { Settings } from "../../../../api";
  import { Input } from "$lib/components/ui/input";
  import Switch from "$lib/components/ui/switch-field";
  import * as Card from "$lib/components/ui/card";

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

<Card.Root size="sm" data-section="network">
  <Card.Header>
    <Card.Title class="flex items-center gap-2">
      <Server size={16} strokeWidth={2.2} /> Server binding and compaction
    </Card.Title>
    <Card.Description>Host and port changes apply after daemon restart. Keep local binding unless remote access is required.</Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-3">
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
  <div class="switch-card app-surface">
    <Switch
      bind:checked={settingsDraft.server.allowRemote}
      label="Allow remote connections"
      description="Restart the daemon after changing host, port, or remote access."
    />
  </div>
  <div class="compaction-card app-surface">
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
  </Card.Content>
</Card.Root>
