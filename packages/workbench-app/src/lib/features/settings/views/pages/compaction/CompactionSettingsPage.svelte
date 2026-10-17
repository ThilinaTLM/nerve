<script lang="ts">
import type { Settings } from "$lib/api";
import {
  SettingsChoiceCards,
  SettingsFieldRow,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsToggleRow,
} from "$lib/presentation/settings";
import type { SettingsChange } from "../settings-change";
import { compactionProfileItems } from "$lib/presentation/settings/compaction-options";

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

function updateCustomTriggerPercent(value: string): void {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 90) return;
  settingsDraft.compaction.customTriggerPercent = parsed;
  onSettingsChange?.(
    { compaction: { customTriggerPercent: parsed } },
    { debounceMs: 350 },
  );
}
</script>

<SettingsSection id="compaction" title="Compaction">
  <SettingsGroup>
    <SettingsToggleRow
      label="Auto-compact long conversations"
      description="Compact between agent iterations instead of stopping at the context limit."
      checked={settingsDraft.compaction.auto}
      onCheckedChange={onAutoCompactionChange}
    />

    {#if settingsDraft.compaction.auto}
      <SettingsRow
        label="Compaction profile"
        description="The profile sets when compaction starts. Every profile keeps about 10,000 tokens of recent messages, within available context and whole message groups."
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
        <div class="grid gap-3">
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
            onValueChange={updateCustomTriggerPercent}
          />
        </div>
      {/if}
    {/if}
  </SettingsGroup>
</SettingsSection>
