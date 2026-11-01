<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import type { NotificationTone, Settings } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  attentionMute,
  sendTestNotification,
} from "$lib/application/notifications";
import {
  SettingsRow,
  SettingsSection,
  SettingsSelectRow,
  SettingsToggleRow,
} from "$lib/presentation/settings";
import type { SettingsChange } from "../settings-change";
import NotificationTonePicker from "./NotificationTonePicker.svelte";

type Props = {
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
    label: "Question for you",
    description: "When an agent asks you a question and waits for your answer.",
  },
  {
    key: "planReview",
    label: "Plan ready for review",
    description: "When an agent presents a plan for your approval.",
  },
  {
    key: "approval",
    label: "Approval needed",
    description: "When a tool call needs your approval.",
  },
  {
    key: "completed",
    label: "Agent finished",
    description:
      "When an agent finishes, including its sub-agents and background commands.",
  },
  {
    key: "failed",
    label: "Agent failed or interrupted",
    description: "When an agent fails or stops unexpectedly.",
  },
];

let { settingsDraft, onSettingsChange }: Props = $props();

const mutedUntilLabel = $derived(
  attentionMute.until === undefined
    ? undefined
    : new Date(attentionMute.until).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
);

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

<SettingsSection id="general" title="General">
  <SettingsToggleRow
    label="System notifications"
    description="Show a desktop or browser notification when you're away from Nerve. While you're using Nerve, a toast appears in the app instead."
    bind:checked={settingsDraft.notifications.systemEnabled}
    onCheckedChange={setSystemEnabled}
  />
  <SettingsToggleRow
    label="Notification sounds"
    description="Play a sound for the events below, unless you're already looking at that conversation."
    bind:checked={settingsDraft.notifications.soundsEnabled}
    onCheckedChange={setSoundsEnabled}
  />
  {#if mutedUntilLabel}
    <Callout
      layout="block"
      tone="info"
      text={`Notifications are muted in this window until ${mutedUntilLabel}.`}
    >
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={attentionMute.unmute}
          >Unmute</Button
        >
      {/snippet}
    </Callout>
  {/if}
  <SettingsRow
    label="Test"
    description="Plays your sound and shows a notification as if you were away."
    layout="responsive"
  >
    {#snippet control()}
      <Button variant="outline" onclick={() => void sendTestNotification()}
        >Send test notification</Button
      >
    {/snippet}
  </SettingsRow>
</SettingsSection>

<SettingsSection id="sounds" title="Sounds">
  {#if !soundsEnabled}
    <Callout
      layout="block"
      tone="info"
      text="Notification sounds are turned off. Enable them in the General section to use these sounds."
    />
  {/if}
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
</SettingsSection>

<p class="text-ui text-muted-foreground">
  Sub-agents only notify you when they need your input. Their results and errors
  go to the lead agent.
</p>
