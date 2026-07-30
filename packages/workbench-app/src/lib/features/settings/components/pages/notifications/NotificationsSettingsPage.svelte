<script lang="ts">
import type { NotificationTone, Settings } from "$lib/api";
import {
  SettingsGroup,
  SettingsInlineMessage,
  SettingsSelectRow,
  SettingsToggleRow,
} from "$lib/presentation/components/settings";
import type { SettingsChange } from "../settings-change";
import NotificationTonePicker from "./NotificationTonePicker.svelte";

type Props = {
  activeTabId: string;
  settingsDraft: Settings;
  onSettingsChange?: SettingsChange;
};

type EventToneKey = keyof Settings["notifications"]["events"];

type EventToneOption = {
  key: EventToneKey;
  label: string;
  description: string;
};

const eventToneOptions: readonly EventToneOption[] = [
  {
    key: "question",
    label: "User question",
    description: "When an agent uses ask_user and waits for your answer.",
  },
  {
    key: "planReview",
    label: "Plan ready for review",
    description: "When an agent presents a plan for your approval.",
  },
  {
    key: "approval",
    label: "Tool approval",
    description: "When supervised mode requires approval for a tool call.",
  },
  {
    key: "completed",
    label: "Run completed",
    description: "When an agent finishes successfully.",
  },
  {
    key: "failed",
    label: "Run failed",
    description: "When an agent stops because of a critical error.",
  },
];

let { activeTabId, settingsDraft, onSettingsChange }: Props = $props();

const soundsEnabled = $derived(settingsDraft.notifications.soundsEnabled);

function setSystemEnabled(checked: boolean): void {
  settingsDraft.notifications.systemEnabled = checked;
  onSettingsChange?.(
    { notifications: { systemEnabled: checked } },
    { immediate: true },
  );
}

function setSoundsEnabled(checked: boolean): void {
  settingsDraft.notifications.soundsEnabled = checked;
  onSettingsChange?.(
    { notifications: { soundsEnabled: checked } },
    { immediate: true },
  );
}

function setEventTone(key: EventToneKey, tone: NotificationTone): void {
  settingsDraft.notifications.events[key] = tone;
  onSettingsChange?.(
    { notifications: { events: { [key]: tone } } },
    { immediate: true },
  );
}
</script>

{#if activeTabId === "general"}
  <SettingsGroup>
    <SettingsToggleRow
      label="System notifications"
      description="Show agent updates through desktop or browser notifications."
      bind:checked={settingsDraft.notifications.systemEnabled}
      onCheckedChange={setSystemEnabled}
    />
    <SettingsToggleRow
      label="Notification sounds"
      description="Play the selected sounds for agent events."
      bind:checked={settingsDraft.notifications.soundsEnabled}
      onCheckedChange={setSoundsEnabled}
    />
  </SettingsGroup>
{:else if activeTabId === "sounds"}
  {#if !soundsEnabled}
    <SettingsInlineMessage
      tone="info"
      text="Notification sounds are turned off. Enable them on the General tab to use these sounds."
    />
  {/if}
  <SettingsGroup>
    {#each eventToneOptions as event (event.key)}
      <SettingsSelectRow
        label={event.label}
        description={event.description}
        disabled={!soundsEnabled}
      >
        {#snippet control(disabled)}
          <NotificationTonePicker
            {disabled}
            value={settingsDraft.notifications.events[event.key]}
            ariaLabel={`${event.label} sound`}
            onValueChange={(value) => setEventTone(event.key, value)}
          />
        {/snippet}
      </SettingsSelectRow>
    {/each}
  </SettingsGroup>
{/if}
