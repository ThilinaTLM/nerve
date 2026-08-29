<script lang="ts">
import type { Settings } from "$lib/api";
import {
  SettingsChoiceCards,
  SettingsFieldRow,
  SettingsGroup,
  SettingsRow,
  SettingsToggleRow,
} from "$lib/presentation/settings";
import type { SettingsChange } from "$lib/features/settings/views/pages/settings-change";
import { compactionProfileItems } from "./agent-options";

type Props = {
  settingsDraft: Settings;
  onSettingsChange?: SettingsChange;
};

let { settingsDraft, onSettingsChange }: Props = $props();

function onAutoCompactionChange(checked: boolean): void {
  settingsDraft.compaction.auto = checked;
  onSettingsChange?.({ compaction: { auto: checked } }, { immediate: true });
}

function onCompactionProfileChange(value: string): void {
  const profile = value as Settings["compaction"]["profile"];
  settingsDraft.compaction.profile = profile;
  onSettingsChange?.({ compaction: { profile } }, { immediate: true });
}

function updateCustomCompactionPercent(
  field: "customTriggerPercent" | "customKeepRecentPercent",
  value: string,
): void {
  const parsed = Number(value);
  const [minimum, maximum] =
    field === "customTriggerPercent" ? [60, 90] : [5, 40];
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return;
  settingsDraft.compaction[field] = parsed;
  onSettingsChange?.({ compaction: { [field]: parsed } }, { debounceMs: 350 });
}
</script>

<SettingsGroup>
  <SettingsToggleRow
    label="Auto-compact long conversations"
    description="Checkpoint completed and remaining work between agent iterations before the model runs out of context."
    checked={settingsDraft.compaction.auto}
    onCheckedChange={onAutoCompactionChange}
  />

  {#if settingsDraft.compaction.auto}
    <SettingsRow
      label="Compaction profile"
      description="Thresholds scale with the selected model's context window."
      layout="stacked"
    >
      <SettingsChoiceCards
        items={compactionProfileItems}
        variant="radio"
        value={settingsDraft.compaction.profile}
        ariaLabel="Compaction profile"
        onValueChange={onCompactionProfileChange}
      />
    </SettingsRow>

    {#if settingsDraft.compaction.profile === "custom"}
      <div class="grid gap-3 sm:grid-cols-2">
        <SettingsFieldRow
          id="compaction-trigger-percent"
          label="Compact at"
          type="number"
          min={60}
          max={90}
          step={1}
          suffix="%"
          hint="60–90% context used"
          value={String(settingsDraft.compaction.customTriggerPercent)}
          onValueChange={(value) =>
            updateCustomCompactionPercent("customTriggerPercent", value)}
        />
        <SettingsFieldRow
          id="compaction-keep-recent-percent"
          label="Retain recent"
          type="number"
          min={5}
          max={40}
          step={1}
          suffix="%"
          hint="5–40% kept verbatim"
          value={String(settingsDraft.compaction.customKeepRecentPercent)}
          onValueChange={(value) =>
            updateCustomCompactionPercent("customKeepRecentPercent", value)}
        />
      </div>
    {/if}
  {/if}
</SettingsGroup>
