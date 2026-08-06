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
  { value: "ping", label: "Ping", detail: "Clear crystalline cue" },
  { value: "pulse", label: "Pulse", detail: "Rounded two-part pulse" },
  { value: "ripple", label: "Ripple", detail: "Soft cascading notes" },
  { value: "sparkle", label: "Sparkle", detail: "Bright ascending shimmer" },
  { value: "knock", label: "Knock", detail: "Short woody tap" },
  { value: "signal", label: "Signal", detail: "Clean neutral double cue" },
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
  ping: "/sounds/ping.mp3",
  pulse: "/sounds/pulse.mp3",
  ripple: "/sounds/ripple.mp3",
  sparkle: "/sounds/sparkle.mp3",
  knock: "/sounds/knock.mp3",
  signal: "/sounds/signal.mp3",
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
  if (typeof window === "undefined") return () => undefined;

  // Defer the sound warm-up to the first user interaction: preloading 12
  // audio files at startup adds a dozen fetches to the cold-start path, and
  // browser audio is only unlocked by a user gesture anyway.
  const unlock = () => {
    removeListeners();
    notificationSoundPlayer.preload();
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
