<script lang="ts">
import Play from "@lucide/svelte/icons/play";
import type {
  NotificationTone,
  Settings,
  UpdateSettingsRequest,
} from "$lib/api";
import {
  notificationToneOptions,
  previewNotificationSound,
} from "$lib/features/notifications/state/notification-sounds";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SelectField from "@nervekit/ui-kit/components/ui/select-field";
import Switch from "@nervekit/ui-kit/components/ui/switch-field";
import { SettingsSectionCard } from "$lib/presentation/components/settings";

type SettingsChange = (
  patch: UpdateSettingsRequest,
  options?: { immediate?: boolean; debounceMs?: number },
) => void;

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

let { settingsDraft, onSettingsChange }: Props = $props();

function setEventTone(key: EventToneKey, tone: NotificationTone): void {
  settingsDraft.notifications.events[key] = tone;
  onSettingsChange?.(
    { notifications: { events: { [key]: tone } } },
    { immediate: true },
  );
}

function previewEventTone(key: EventToneKey): void {
  const tone = settingsDraft.notifications.events[key];
  if (tone !== "none") previewNotificationSound(tone);
}
</script>

<SettingsSectionCard section="notification-general" title="General">
  <div class="settings-row">
    <Switch
      class="settings-full-switch"
      bind:checked={settingsDraft.notifications.systemEnabled}
      label="System notifications"
      description="Show agent updates through desktop or browser notifications."
      onCheckedChange={(checked) => {
        settingsDraft.notifications.systemEnabled = checked;
        onSettingsChange?.(
          { notifications: { systemEnabled: checked } },
          { immediate: true },
        );
      }}
    />
  </div>
  <div class="settings-row">
    <Switch
      class="settings-full-switch"
      bind:checked={settingsDraft.notifications.soundsEnabled}
      label="Notification sounds"
      description="Play the selected sounds for agent events."
      onCheckedChange={(checked) => {
        settingsDraft.notifications.soundsEnabled = checked;
        onSettingsChange?.(
          { notifications: { soundsEnabled: checked } },
          { immediate: true },
        );
      }}
    />
  </div>
</SettingsSectionCard>

<SettingsSectionCard section="notification-sounds" title="Sounds">
  {#each eventToneOptions as event (event.key)}
    <div class="settings-row">
      <div class="settings-copy">
        <strong>{event.label}</strong>
        <span>{event.description}</span>
      </div>
      <div class="flex w-full max-w-sm items-center gap-2">
        <SelectField
          class="min-w-0 flex-1"
          items={[...notificationToneOptions]}
          value={settingsDraft.notifications.events[event.key]}
          ariaLabel={`${event.label} sound`}
          onValueChange={(value) =>
            setEventTone(event.key, value as NotificationTone)}
        />
        <Button
          variant="outline"
          size="icon-sm"
          ariaLabel={`Preview ${event.label} sound`}
          title={`Preview ${event.label} sound`}
          disabled={settingsDraft.notifications.events[event.key] === "none"}
          onclick={() => previewEventTone(event.key)}
        >
          <Play class="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  {/each}
</SettingsSectionCard>
