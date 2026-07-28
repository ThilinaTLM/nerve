export type NotificationSound = "attention" | "complete" | "error";

type NotificationAudio = {
  currentTime: number;
  preload: string;
  load?: () => void;
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

const SOUND_SOURCES: Record<NotificationSound, string> = {
  attention: "/sounds/notification-attention.wav",
  complete: "/sounds/notification-complete.wav",
  error: "/sounds/notification-error.wav",
};

const DEFAULT_COOLDOWN_MS = 750;

export function createNotificationSoundPlayer(
  options: NotificationSoundPlayerOptions = {},
) {
  const audioFactory = options.audioFactory ?? browserAudioFactory;
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const audioBySound = new Map<NotificationSound, NotificationAudio>();
  let lastPlayedAt = Number.NEGATIVE_INFINITY;

  function audioFor(sound: NotificationSound): NotificationAudio | undefined {
    const existing = audioBySound.get(sound);
    if (existing) return existing;

    const audio = audioFactory(SOUND_SOURCES[sound]);
    if (!audio) return undefined;
    audio.preload = "auto";
    audio.load?.();
    audioBySound.set(sound, audio);
    return audio;
  }

  return {
    preload(): void {
      for (const sound of Object.keys(SOUND_SOURCES) as NotificationSound[]) {
        audioFor(sound);
      }
    },
    play(sound: NotificationSound): void {
      const playedAt = now();
      if (playedAt - lastPlayedAt < cooldownMs) return;

      const audio = audioFor(sound);
      if (!audio) return;
      lastPlayedAt = playedAt;
      try {
        audio.currentTime = 0;
        void Promise.resolve(audio.play()).catch(() => undefined);
      } catch {
        // Browser autoplay and media errors must not interrupt event delivery.
      }
    },
  };
}

function browserAudioFactory(source: string): NotificationAudio | undefined {
  if (typeof Audio === "undefined") return undefined;
  return new Audio(source);
}

const notificationSoundPlayer = createNotificationSoundPlayer();

export function preloadNotificationSounds(): void {
  notificationSoundPlayer.preload();
}

export function playNotificationSound(sound: NotificationSound): void {
  notificationSoundPlayer.play(sound);
}
