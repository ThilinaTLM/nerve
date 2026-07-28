import type { NotificationTone } from "@nervekit/contracts";

export type PlayableNotificationTone = Exclude<NotificationTone, "none">;

export type NotificationToneOption = {
  value: NotificationTone;
  label: string;
  detail: string;
};

export const notificationToneOptions: readonly NotificationToneOption[] = [
  { value: "none", label: "None", detail: "Do not play a sound" },
  { value: "bell", label: "Bell", detail: "Soft two-note bell" },
  { value: "chime", label: "Chime", detail: "Gentle three-note chime" },
  { value: "click", label: "Click", detail: "Short and understated" },
  { value: "pop", label: "Pop", detail: "Soft rounded pop" },
  { value: "success", label: "Success", detail: "Warm ascending notes" },
  { value: "alert", label: "Alert", detail: "Restrained descending notes" },
  {
    value: "kenney-click-1",
    label: "Interface Click 1",
    detail: "Kenney UI Audio · click1",
  },
  {
    value: "kenney-click-2",
    label: "Interface Click 2",
    detail: "Kenney UI Audio · click2",
  },
  {
    value: "kenney-click-3",
    label: "Interface Click 3",
    detail: "Kenney UI Audio · click3",
  },
  {
    value: "kenney-rollover-1",
    label: "Interface Rollover 1",
    detail: "Kenney UI Audio · rollover1",
  },
  {
    value: "kenney-rollover-4",
    label: "Interface Rollover 2",
    detail: "Kenney UI Audio · rollover4",
  },
  {
    value: "kenney-rollover-6",
    label: "Interface Rollover 3",
    detail: "Kenney UI Audio · rollover6",
  },
  {
    value: "kenney-switch-1",
    label: "Interface Tone 1",
    detail: "Kenney UI Audio · switch1",
  },
  {
    value: "kenney-switch-7",
    label: "Interface Tone 2",
    detail: "Kenney UI Audio · switch7",
  },
  {
    value: "kenney-switch-10",
    label: "Interface Tone 3",
    detail: "Kenney UI Audio · switch10",
  },
  {
    value: "kenney-switch-15",
    label: "Interface Tone 4",
    detail: "Kenney UI Audio · switch15",
  },
  {
    value: "kenney-switch-20",
    label: "Interface Tone 5",
    detail: "Kenney UI Audio · switch20",
  },
  {
    value: "kenney-switch-31",
    label: "Interface Tone 6",
    detail: "Kenney UI Audio · switch31",
  },
];

type NotificationAudio = {
  currentTime: number;
  muted: boolean;
  preload: string;
  load?: () => void;
  pause: () => void;
  play: () => Promise<unknown> | unknown;
};

type NotificationAudioFactory = (
  source: string,
) => NotificationAudio | undefined;

type NotificationSoundPlayerOptions = {
  audioFactory?: NotificationAudioFactory;
  now?: () => number;
  cooldownMs?: number;
};

const SOUND_SOURCES: Record<PlayableNotificationTone, string> = {
  bell: "/sounds/bell.mp3",
  chime: "/sounds/chime.mp3",
  click: "/sounds/click.mp3",
  pop: "/sounds/pop.mp3",
  success: "/sounds/success.mp3",
  alert: "/sounds/alert.mp3",
  "kenney-click-1": "/sounds/kenney-click-1.mp3",
  "kenney-click-2": "/sounds/kenney-click-2.mp3",
  "kenney-click-3": "/sounds/kenney-click-3.mp3",
  "kenney-rollover-1": "/sounds/kenney-rollover-1.mp3",
  "kenney-rollover-4": "/sounds/kenney-rollover-4.mp3",
  "kenney-rollover-6": "/sounds/kenney-rollover-6.mp3",
  "kenney-switch-1": "/sounds/kenney-switch-1.mp3",
  "kenney-switch-7": "/sounds/kenney-switch-7.mp3",
  "kenney-switch-10": "/sounds/kenney-switch-10.mp3",
  "kenney-switch-15": "/sounds/kenney-switch-15.mp3",
  "kenney-switch-20": "/sounds/kenney-switch-20.mp3",
  "kenney-switch-31": "/sounds/kenney-switch-31.mp3",
};

const playableTones = Object.keys(SOUND_SOURCES) as PlayableNotificationTone[];
const DEFAULT_COOLDOWN_MS = 750;

export function createNotificationSoundPlayer(
  options: NotificationSoundPlayerOptions = {},
) {
  const audioFactory = options.audioFactory ?? browserAudioFactory;
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const audioByTone = new Map<PlayableNotificationTone, NotificationAudio>();
  const operationByTone = new Map<PlayableNotificationTone, number>();
  let lastPlayedAt = Number.NEGATIVE_INFINITY;
  let playSequence = 0;

  function audioFor(
    tone: PlayableNotificationTone,
  ): NotificationAudio | undefined {
    const existing = audioByTone.get(tone);
    if (existing) return existing;

    const audio = audioFactory(SOUND_SOURCES[tone]);
    if (!audio) return undefined;
    audio.preload = "auto";
    audio.load?.();
    audioByTone.set(tone, audio);
    return audio;
  }

  function playAudio(
    tone: PlayableNotificationTone,
    options: { bypassCooldown: boolean },
  ): void {
    const playedAt = now();
    if (!options.bypassCooldown && playedAt - lastPlayedAt < cooldownMs) return;

    const audio = audioFor(tone);
    if (!audio) return;
    const sequence = ++playSequence;
    const operation = (operationByTone.get(tone) ?? 0) + 1;
    operationByTone.set(tone, operation);
    if (!options.bypassCooldown) lastPlayedAt = playedAt;
    try {
      audio.muted = false;
      audio.currentTime = 0;
      void Promise.resolve(audio.play()).catch(() => {
        if (!options.bypassCooldown && playSequence === sequence) {
          lastPlayedAt = Number.NEGATIVE_INFINITY;
        }
      });
    } catch {
      if (!options.bypassCooldown && playSequence === sequence) {
        lastPlayedAt = Number.NEGATIVE_INFINITY;
      }
    }
  }

  return {
    preload(): void {
      for (const tone of playableTones) audioFor(tone);
    },
    unlock(): void {
      for (const tone of playableTones) {
        const audio = audioFor(tone);
        if (!audio) continue;
        const previousMuted = audio.muted;
        const operation = (operationByTone.get(tone) ?? 0) + 1;
        operationByTone.set(tone, operation);
        audio.muted = true;
        audio.currentTime = 0;
        const restore = () => {
          if (operationByTone.get(tone) !== operation) return;
          audio.pause();
          audio.currentTime = 0;
          audio.muted = previousMuted;
        };
        try {
          void Promise.resolve(audio.play()).then(restore).catch(restore);
        } catch {
          restore();
        }
      }
    },
    play(tone: PlayableNotificationTone): void {
      playAudio(tone, { bypassCooldown: false });
    },
    preview(tone: PlayableNotificationTone): void {
      playAudio(tone, { bypassCooldown: true });
    },
  };
}

function browserAudioFactory(source: string): NotificationAudio | undefined {
  if (typeof Audio === "undefined") return undefined;
  return new Audio(source);
}

const notificationSoundPlayer = createNotificationSoundPlayer();

export function initializeNotificationSoundPlayback(): () => void {
  notificationSoundPlayer.preload();
  if (typeof window === "undefined") return () => undefined;

  const unlock = () => {
    removeListeners();
    notificationSoundPlayer.unlock();
  };
  const removeListeners = () => {
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  return removeListeners;
}

export function playNotificationSound(tone: PlayableNotificationTone): void {
  notificationSoundPlayer.play(tone);
}

export function previewNotificationSound(tone: PlayableNotificationTone): void {
  notificationSoundPlayer.preview(tone);
}
