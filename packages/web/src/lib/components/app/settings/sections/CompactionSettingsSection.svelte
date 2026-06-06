<script lang="ts">
  import Shield from "@lucide/svelte/icons/shield";
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

  function updateNumber(path: "reserveTokens" | "keepRecentTokens", value: string) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      const next = Math.floor(parsed);
      settingsDraft.compaction[path] = next;
      onSettingsChange?.(
        path === "reserveTokens"
          ? { compaction: { reserveTokens: next } }
          : { compaction: { keepRecentTokens: next } },
        { debounceMs: 650 },
      );
    }
  }
</script>

<section id="settings-compaction" class="settings-section" data-section="compaction">
  <header class="settings-section-header">
    <div class="settings-section-kicker"><Shield size={14} strokeWidth={2.1} /> Compaction</div>
    <h2>Transcript compaction</h2>
    <p>Let the daemon compact long branches when model-aware thresholds are reached.</p>
  </header>
  <div class="settings-section-body">
    <div class="settings-row">
      <Switch
        class="settings-full-switch"
        bind:checked={settingsDraft.compaction.auto}
        label="Auto-compact sessions"
        description="Automatically summarize long session branches when they approach the context limit."
        onCheckedChange={(checked) => {
          settingsDraft.compaction.auto = checked;
          onSettingsChange?.({ compaction: { auto: checked } }, { immediate: true });
        }}
      />
    </div>

    <div class="settings-field-grid">
      <label>
        <span>Reserve tokens</span>
        <Input
          value={String(settingsDraft.compaction.reserveTokens)}
          type="number"
          size="sm"
          ariaLabel="Compaction reserve tokens"
          oninput={(event) => updateNumber("reserveTokens", (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label>
        <span>Keep recent</span>
        <Input
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
