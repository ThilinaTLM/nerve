import {
  onWorkbenchChannelReadyChange,
  requestWorkbench,
} from "$lib/application/startup/workbench-connection";
import { createPresenceReporter } from "./presence-reporter";
import { attentionMute, isPresenceActive } from "./attention-delivery.svelte";

/** Input idle detection needs a tick; becoming active is reported at once. */
const IDLE_CHECK_MS = 5_000;
const INPUT_EVENTS = ["keydown", "pointerdown", "wheel"] as const;

/**
 * Reports this window's presence and mute state for the daemon's push
 * decision. Pointer moves are not listened to: a focus or click reports
 * activity, and the idle tick reports its end.
 */
export function startPresenceReporting(): () => void {
  const reporter = createPresenceReporter((presence) =>
    requestWorkbench("access.presence.report", presence),
  );
  const current = () => ({
    active: isPresenceActive(),
    muted: attentionMute.muted,
  });
  const sync = () => reporter.sync(current());

  const stopReady = onWorkbenchChannelReadyChange((ready) => {
    if (ready) reporter.sync(current(), true);
  });
  const stopEffects = $effect.root(() => {
    $effect(() => {
      void attentionMute.muted;
      sync();
    });
  });
  const tick = setInterval(sync, IDLE_CHECK_MS);
  for (const name of INPUT_EVENTS) {
    window.addEventListener(name, sync, { capture: true, passive: true });
  }
  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);
  document.addEventListener("visibilitychange", sync);
  sync();

  return () => {
    clearInterval(tick);
    for (const name of INPUT_EVENTS) {
      window.removeEventListener(name, sync, true);
    }
    window.removeEventListener("focus", sync);
    window.removeEventListener("blur", sync);
    document.removeEventListener("visibilitychange", sync);
    stopReady();
    stopEffects();
  };
}
